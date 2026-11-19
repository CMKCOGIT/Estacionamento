import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import {
  formatarPlaca,
  normalizarPlaca,
  placaValida,
  type ConsultaPlaca,
  type DadosVeiculo,
  type ListaVeiculos,
  type PaginaEstadias,
  type VeiculoDetalhe,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import type { Conexao } from '../../db/pool.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { AppError, erros } from '../../http/erros.js';
import { veiculosRepository as repo, type FiltroVeiculos } from './veiculos.repository.js';

export interface Ator {
  usuarioId: string;
  contexto: ContextoAuditoria;
}

/** Placa normalizada e validada (padrão antigo/Mercosul, ou estrangeira se marcada). */
export function validarPlaca(placa: string, estrangeira = false): string {
  const p = normalizarPlaca(placa);
  if (!placaValida(p, estrangeira)) {
    throw erros.requisicaoInvalida('Placa inválida', [
      {
        campo: 'placa',
        mensagem: estrangeira
          ? 'Placa estrangeira: use de 4 a 10 letras e números'
          : 'Use o padrão ABC1234 ou Mercosul ABC1D23 (ou marque "placa estrangeira")',
      },
    ]);
  }
  return p;
}

function limparTexto(v: string | null | undefined, max: number): string | null {
  const t = v?.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
}

async function categoriaAtiva(c: Conexao, siteId: string, categoriaId: string) {
  const [[l]] = await c.query<RowDataPacket[]>(
    'SELECT nome, ativo FROM categorias_veiculo WHERE id = ? AND site_id = ?',
    [categoriaId, siteId],
  );
  if (!l)
    throw erros.requisicaoInvalida('Categoria inexistente', [
      { campo: 'categoriaId', mensagem: 'Categoria não encontrada' },
    ]);
  if (!Number(l.ativo)) throw erros.regraDeNegocio(`A categoria "${l.nome}" está desativada.`);
}

/** Erro de placa repetida com o id do cadastro existente (o painel oferece abri-lo). */
async function exigirPlacaLivre(c: Conexao, siteId: string, placa: string, exceto: string | null) {
  const [[l]] = await c.query<RowDataPacket[]>(
    'SELECT id FROM veiculos WHERE site_id = ? AND placa = ? AND (? IS NULL OR id <> ?)',
    [siteId, placa, exceto, exceto],
  );
  if (l) {
    throw new AppError(
      409,
      'REGISTRO_DUPLICADO',
      `Já existe um veículo cadastrado com a placa ${formatarPlaca(placa)}.`,
      {
        veiculoId: String(l.id),
      },
    );
  }
}

/**
 * Regra operacional: um veículo não pode ter duas estadias abertas.
 * Usada pelo registro de entrada (e garantida também pelo índice
 * uq_sessoes_veiculo_aberto, inclusive com dois operadores ao mesmo tempo).
 */
export async function exigirVeiculoForaDoEstacionamento(c: Conexao, veiculoId: string) {
  const [[l]] = await c.query<RowDataPacket[]>(
    `SELECT s.numero, s.placa, s.entrada_em, v.codigo AS vaga
       FROM sessoes_estacionamento s LEFT JOIN vagas v ON v.id = s.vaga_id
      WHERE s.veiculo_aberto_id = ?`,
    [veiculoId],
  );
  if (l) {
    const hora = (l.entrada_em as Date).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    });
    throw erros.regraDeNegocio(
      `O veículo ${formatarPlaca(String(l.placa))} já está estacionado${l.vaga ? ` na vaga ${l.vaga}` : ''} desde ${hora} (ticket nº ${l.numero}). Registre a saída antes de uma nova entrada.`,
    );
  }
}

async function detalhar(siteId: string, id: string): Promise<VeiculoDetalhe> {
  const v = await repo.buscarPorId(siteId, id);
  if (!v) throw erros.naoEncontrado('Veículo não encontrado');
  const { primeiraVisitaEm, ...resto } = v;
  return { ...resto, estatisticas: { ...(await repo.estatisticas(id)), primeiraVisitaEm } };
}

export const veiculosService = {
  async listar(filtro: FiltroVeiculos): Promise<ListaVeiculos> {
    const site = await obterSiteAtual();
    const r = await repo.listar(site.id, filtro);
    return {
      itens: r.itens.map(
        ({ observacoes: _o, criadoEm: _c, atualizadoEm: _a, primeiraVisitaEm: _p, ...v }) => v,
      ),
      total: r.total,
      estacionadosAgora: r.estacionadosAgora,
      proximaPagina: filtro.pagina * filtro.limite < r.total ? filtro.pagina + 1 : null,
    };
  },

  obter: async (id: string) => detalhar((await obterSiteAtual()).id, id),

  /** Consulta por placa (aceita "abc-1d23", "ABC 1234"...). */
  async consultarPlaca(placaDigitada: string): Promise<ConsultaPlaca> {
    const site = await obterSiteAtual();
    const placa = normalizarPlaca(placaDigitada);
    const valida = placaValida(placa) || placaValida(placa, true);
    const v = valida ? await repo.buscarPorPlaca(site.id, placa) : null;
    return { placa, valida, veiculo: v ? await detalhar(site.id, v.id) : null };
  },

  async estadias(id: string, pagina: number, limite: number): Promise<PaginaEstadias> {
    const site = await obterSiteAtual();
    if (!(await repo.buscarPorId(site.id, id))) throw erros.naoEncontrado('Veículo não encontrado');
    const r = await repo.estadias(id, pagina, limite);
    return { itens: r.itens, proximaPagina: r.temMais ? String(pagina + 1) : null };
  },

  async criar(ator: Ator, dados: DadosVeiculo): Promise<VeiculoDetalhe> {
    const site = await obterSiteAtual();
    const placa = validarPlaca(dados.placa, dados.placaEstrangeira);
    const id = ulid();
    await comTransacao(ator.contexto, async (c) => {
      await categoriaAtiva(c, site.id, dados.categoriaId);
      await exigirPlacaLivre(c, site.id, placa, null);
      await c.query(
        `INSERT INTO veiculos (id, site_id, placa, placa_estrangeira, categoria_id, marca, modelo, cor, observacoes, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          site.id,
          placa,
          dados.placaEstrangeira ?? false,
          dados.categoriaId,
          limparTexto(dados.marca, 40),
          limparTexto(dados.modelo, 60),
          limparTexto(dados.cor, 30),
          limparTexto(dados.observacoes, 500),
          ator.usuarioId,
        ],
      );
    });
    return detalhar(site.id, id);
  },

  /**
   * Edita o cadastro. Correção de placa:
   *  - tickets já encerrados mantêm a placa registrada na época (histórico preservado);
   *  - se o veículo está estacionado, o ticket aberto acompanha a correção.
   */
  async editar(ator: Ator, id: string, dados: DadosVeiculo): Promise<VeiculoDetalhe> {
    const site = await obterSiteAtual();
    const atual = await repo.buscarPorId(site.id, id);
    if (!atual) throw erros.naoEncontrado('Veículo não encontrado');
    const placa = validarPlaca(dados.placa, dados.placaEstrangeira);

    await comTransacao(ator.contexto, async (c) => {
      await categoriaAtiva(c, site.id, dados.categoriaId);
      if (placa !== atual.placa) await exigirPlacaLivre(c, site.id, placa, id);
      await c.query(
        'UPDATE veiculos SET placa = ?, placa_estrangeira = ?, categoria_id = ?, marca = ?, modelo = ?, cor = ?, observacoes = ? WHERE id = ?',
        [
          placa,
          dados.placaEstrangeira ?? false,
          dados.categoriaId,
          limparTexto(dados.marca, 40),
          limparTexto(dados.modelo, 60),
          limparTexto(dados.cor, 30),
          limparTexto(dados.observacoes, 500),
          id,
        ],
      );
      if (placa !== atual.placa && atual.estadiaAtual) {
        await c.query("UPDATE sessoes_estacionamento SET placa = ? WHERE id = ? AND status = 'ABERTA'", [
          placa,
          atual.estadiaAtual.sessaoId,
        ]);
      }
    });
    return detalhar(site.id, id);
  },

  /** Só exclui veículo sem nenhuma estadia; com histórico, o cadastro é preservado. */
  async remover(ator: Ator, id: string): Promise<{ placa: string }> {
    const site = await obterSiteAtual();
    const v = await repo.buscarPorId(site.id, id);
    if (!v) throw erros.naoEncontrado('Veículo não encontrado');
    if (v.totalEstadias > 0) {
      throw new AppError(
        409,
        'REGISTRO_EM_USO',
        `O veículo ${formatarPlaca(v.placa)} tem ${v.totalEstadias} estadia(s) registrada(s) e não pode ser excluído: o histórico precisa ser preservado.`,
      );
    }
    await comTransacao(ator.contexto, async (c) => {
      await c.query('DELETE FROM cliente_veiculos WHERE veiculo_id = ?', [id]);
      await c.query('DELETE FROM veiculos WHERE id = ?', [id]);
    });
    return { placa: v.placa };
  },
};
