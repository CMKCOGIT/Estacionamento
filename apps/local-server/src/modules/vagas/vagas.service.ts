import { ulid } from 'ulid';
import {
  compararCodigos,
  gerarCodigosVaga,
  normalizarCodigoVaga,
  PADRAO_CODIGO_VAGA,
  type AlterarCapacidade,
  type DadosVaga,
  type ListaVagas,
  type NovasVagasLote,
  type ResultadoCapacidade,
  type ResultadoRemocao,
  type VagaDetalhe,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import type { Conexao } from '../../db/pool.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { AppError, erros } from '../../http/erros.js';
import { publicarDisponibilidade } from '../../sync/outbox.js';
import { vagasRepository as repo, type LinhaVagaBruta } from './vagas.repository.js';

export interface Ator {
  usuarioId: string;
  contexto: ContextoAuditoria;
}

export const LIMITE_VAGAS_POR_OPERACAO = 500;

function validarCodigo(codigo: string): string {
  const c = normalizarCodigoVaga(codigo);
  if (!PADRAO_CODIGO_VAGA.test(c)) {
    throw erros.requisicaoInvalida('Código de vaga inválido', [
      { campo: 'codigo', mensagem: 'Use até 20 caracteres: letras, números e hífen (ex.: A-01)' },
    ]);
  }
  return c;
}

async function categoriaAtiva(c: Conexao, siteId: string, categoriaId: string) {
  const cat = await repo.travarCategoria(c, siteId, categoriaId);
  if (!cat)
    throw erros.requisicaoInvalida('Categoria inexistente', [
      { campo: 'categoriaId', mensagem: 'Categoria não encontrada' },
    ]);
  if (!cat.ativo) throw erros.regraDeNegocio(`A categoria "${cat.nome}" está desativada.`);
  return cat;
}

/** Registra a mudança de capacidade da categoria (se houver) e publica a disponibilidade. */
async function finalizar(
  c: Conexao,
  o: {
    siteId: string;
    categoriaId: string;
    anterior: number;
    afetadas: Record<string, string[]>;
    motivo: string;
    usuarioId: string;
  },
) {
  const nova = await repo.capacidade(c, o.categoriaId);
  if (nova !== o.anterior) {
    await c.query(
      `INSERT INTO capacidade_alteracoes (id, site_id, categoria_id, capacidade_anterior, capacidade_nova, vagas_afetadas, motivo, alterado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ulid(), o.siteId, o.categoriaId, o.anterior, nova, JSON.stringify(o.afetadas), o.motivo, o.usuarioId],
    );
  }
  await publicarDisponibilidade(c, o.siteId);
  return nova;
}

async function carregar(siteId: string, id: string, c?: Conexao) {
  const r = await repo.buscar(siteId, id, c);
  if (!r) throw erros.naoEncontrado('Vaga não encontrada');
  return r;
}

function exigirNaoOcupada(v: { codigo: string; ocupacao: { placa: string } | null }, acao: string) {
  if (v.ocupacao) {
    throw erros.regraDeNegocio(
      `A vaga ${v.codigo} está ocupada pelo veículo ${v.ocupacao.placa}. Registre a saída antes de ${acao}.`,
    );
  }
}

/** Remove uma vaga: exclui se nunca foi usada; senão desativa (o histórico aponta para ela). */
async function removerLinha(c: Conexao, v: LinhaVagaBruta): Promise<'EXCLUIDA' | 'DESATIVADA'> {
  if (v.temHistorico) {
    await c.query(
      `UPDATE vagas SET situacao = 'INATIVA', desativada_em = NOW(3),
              motivo_bloqueio = NULL, bloqueada_em = NULL, bloqueada_por = NULL
        WHERE id = ?`,
      [v.id],
    );
    return 'DESATIVADA';
  }
  await c.query('DELETE FROM vagas WHERE id = ?', [v.id]);
  return 'EXCLUIDA';
}

/** Próximos códigos livres para um prefixo (continua a numeração existente). */
function proximosCodigos(existentes: string[], prefixo: string, quantidade: number): string[] {
  const p = normalizarCodigoVaga(prefixo);
  const usados = new Set(existentes);
  let maior = 0;
  let digitos = 2;
  for (const cod of existentes) {
    if (!cod.startsWith(p)) continue;
    const resto = cod.slice(p.length);
    if (/^\d+$/.test(resto)) {
      maior = Math.max(maior, Number(resto));
      digitos = Math.max(digitos, resto.length);
    }
  }
  const novos: string[] = [];
  for (let n = maior + 1; novos.length < quantidade; n++) {
    const cod = `${p}${String(n).padStart(digitos, '0')}`;
    if (!usados.has(cod)) novos.push(cod);
  }
  return novos;
}

export const vagasService = {
  async listar(filtro: {
    categoriaId?: string;
    setor?: string;
    estado?: string;
    busca?: string;
    incluirRemovidas: boolean;
  }): Promise<ListaVagas> {
    const site = await obterSiteAtual();
    const todas = await repo.listar(site.id);
    const porCategoriaSetor = todas.filter(
      (v) =>
        (!filtro.categoriaId || v.categoriaId === filtro.categoriaId) &&
        (!filtro.setor || (v.setor ?? '') === filtro.setor),
    );
    const resumo = { total: 0, livres: 0, ocupadas: 0, bloqueadas: 0, removidas: 0 };
    for (const v of porCategoriaSetor) {
      if (v.estado === 'REMOVIDA') resumo.removidas++;
      else {
        resumo.total++;
        if (v.estado === 'LIVRE') resumo.livres++;
        if (v.estado === 'OCUPADA') resumo.ocupadas++;
        if (v.estado === 'BLOQUEADA') resumo.bloqueadas++;
      }
    }
    const termo = filtro.busca
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');
    const itens = porCategoriaSetor.filter(
      (v) =>
        (filtro.incluirRemovidas || filtro.estado === 'REMOVIDA' || v.estado !== 'REMOVIDA') &&
        (!filtro.estado || v.estado === filtro.estado) &&
        (!termo ||
          v.codigo.includes(termo) ||
          (v.ocupacao?.placa.includes(termo.replace(/-/g, '')) ?? false)),
    );
    const setores = [...new Set(todas.filter((v) => v.estado !== 'REMOVIDA').map((v) => v.setor ?? ''))].sort(
      (a, b) => a.localeCompare(b),
    );
    return { itens, resumo, setores, atualizadoEm: new Date().toISOString() };
  },

  async obter(id: string): Promise<VagaDetalhe> {
    const site = await obterSiteAtual();
    const r = await carregar(site.id, id);
    return {
      ...r.vaga,
      ultimosUsos: await repo.ultimosUsos(id),
      criadaEm: r.criadaEm,
      desativadaEm: r.desativadaEm,
    };
  },

  async criar(ator: Ator, dados: DadosVaga) {
    const site = await obterSiteAtual();
    const codigo = validarCodigo(dados.codigo);
    const id = ulid();
    await comTransacao(ator.contexto, async (c) => {
      await categoriaAtiva(c, site.id, dados.categoriaId);
      const anterior = await repo.capacidade(c, dados.categoriaId);
      await c.query(
        'INSERT INTO vagas (id, site_id, codigo, setor, categoria_id, coberta, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          site.id,
          codigo,
          dados.setor?.trim() || null,
          dados.categoriaId,
          dados.coberta ?? false,
          dados.observacao?.trim() || null,
        ],
      );
      await finalizar(c, {
        siteId: site.id,
        categoriaId: dados.categoriaId,
        anterior,
        afetadas: { criadas: [codigo] },
        motivo: ator.contexto.motivo ?? 'Vaga cadastrada',
        usuarioId: ator.usuarioId,
      });
    });
    return this.obter(id);
  },

  async criarLote(ator: Ator, lote: NovasVagasLote) {
    const site = await obterSiteAtual();
    if (lote.quantidade < 1 || lote.quantidade > LIMITE_VAGAS_POR_OPERACAO) {
      throw erros.requisicaoInvalida(`Informe de 1 a ${LIMITE_VAGAS_POR_OPERACAO} vagas por vez`);
    }
    const codigos = gerarCodigosVaga(lote.prefixo, lote.inicio, lote.quantidade, lote.digitos).map(
      validarCodigo,
    );
    return comTransacao(ator.contexto, async (c) => {
      await categoriaAtiva(c, site.id, lote.categoriaId);
      const repetidos = await repo.codigosExistentes(c, site.id, codigos);
      if (repetidos.length) {
        throw new AppError(
          409,
          'REGISTRO_DUPLICADO',
          `Já existem vagas com estes códigos: ${repetidos.sort(compararCodigos).slice(0, 10).join(', ')}${repetidos.length > 10 ? '…' : ''}`,
          {
            codigos: repetidos,
          },
        );
      }
      const anterior = await repo.capacidade(c, lote.categoriaId);
      await c.query('INSERT INTO vagas (id, site_id, codigo, setor, categoria_id, coberta) VALUES ?', [
        codigos.map((codigo) => [
          ulid(),
          site.id,
          codigo,
          lote.setor?.trim() || null,
          lote.categoriaId,
          lote.coberta ?? false,
        ]),
      ]);
      const nova = await finalizar(c, {
        siteId: site.id,
        categoriaId: lote.categoriaId,
        anterior,
        afetadas: { criadas: codigos },
        motivo: ator.contexto.motivo ?? 'Vagas cadastradas em lote',
        usuarioId: ator.usuarioId,
      });
      return { criadas: codigos, capacidade: nova };
    });
  },

  async editar(ator: Ator, id: string, dados: DadosVaga) {
    const site = await obterSiteAtual();
    const atual = await carregar(site.id, id);
    if (atual.vaga.estado === 'REMOVIDA') throw erros.regraDeNegocio('Reative a vaga antes de editá-la.');
    const codigo = validarCodigo(dados.codigo);
    const mudouCategoria = dados.categoriaId !== atual.vaga.categoriaId;
    if (mudouCategoria) exigirNaoOcupada(atual.vaga, 'mudar a categoria');

    await comTransacao(ator.contexto, async (c) => {
      if (mudouCategoria) await categoriaAtiva(c, site.id, dados.categoriaId);
      const antes = mudouCategoria
        ? [await repo.capacidade(c, atual.vaga.categoriaId), await repo.capacidade(c, dados.categoriaId)]
        : [];
      await c.query(
        'UPDATE vagas SET codigo = ?, setor = ?, categoria_id = ?, coberta = ?, observacao = ? WHERE id = ?',
        [
          codigo,
          dados.setor?.trim() || null,
          dados.categoriaId,
          dados.coberta ?? false,
          dados.observacao?.trim() || null,
          id,
        ],
      );
      const motivo = ator.contexto.motivo ?? 'Vaga mudou de categoria';
      if (mudouCategoria) {
        await finalizar(c, {
          siteId: site.id,
          categoriaId: atual.vaga.categoriaId,
          anterior: antes[0]!,
          afetadas: { saiu: [codigo] },
          motivo,
          usuarioId: ator.usuarioId,
        });
        await finalizar(c, {
          siteId: site.id,
          categoriaId: dados.categoriaId,
          anterior: antes[1]!,
          afetadas: { entrou: [codigo] },
          motivo,
          usuarioId: ator.usuarioId,
        });
      }
    });
    return this.obter(id);
  },

  /** Bloqueio manual (manutenção, reserva...). A vaga deixa de receber veículos. */
  async bloquear(ator: Ator, id: string, motivo: string) {
    const site = await obterSiteAtual();
    const { vaga } = await carregar(site.id, id);
    if (vaga.estado === 'BLOQUEADA') throw erros.regraDeNegocio(`A vaga ${vaga.codigo} já está bloqueada.`);
    if (vaga.estado === 'REMOVIDA') throw erros.regraDeNegocio('Vaga removida não pode ser bloqueada.');
    exigirNaoOcupada(vaga, 'bloquear');
    await comTransacao(ator.contexto, async (c) => {
      await c.query(
        "UPDATE vagas SET situacao = 'MANUTENCAO', motivo_bloqueio = ?, bloqueada_em = NOW(3), bloqueada_por = ? WHERE id = ? AND situacao = 'ATIVA'",
        [motivo, ator.usuarioId, id],
      );
      await publicarDisponibilidade(c, site.id);
    });
    return this.obter(id);
  },

  async liberar(ator: Ator, id: string) {
    const site = await obterSiteAtual();
    const { vaga } = await carregar(site.id, id);
    if (vaga.estado !== 'BLOQUEADA') throw erros.regraDeNegocio(`A vaga ${vaga.codigo} não está bloqueada.`);
    await comTransacao(ator.contexto, async (c) => {
      await c.query(
        "UPDATE vagas SET situacao = 'ATIVA', motivo_bloqueio = NULL, bloqueada_em = NULL, bloqueada_por = NULL WHERE id = ? AND situacao = 'MANUTENCAO'",
        [id],
      );
      await publicarDisponibilidade(c, site.id);
    });
    return this.obter(id);
  },

  /** "Excluir": apaga se nunca foi usada; se tem histórico, desativa (fica como removida). */
  async remover(ator: Ator, id: string): Promise<ResultadoRemocao> {
    const site = await obterSiteAtual();
    const { vaga } = await carregar(site.id, id);
    if (vaga.estado === 'REMOVIDA') throw erros.regraDeNegocio('Esta vaga já foi removida.');
    exigirNaoOcupada(vaga, 'remover');
    return comTransacao(ator.contexto, async (c) => {
      const anterior = await repo.capacidade(c, vaga.categoriaId);
      // Confere de novo com as linhas travadas: um veículo pode ter entrado neste meio-tempo.
      const linha = (await repo.vagasDaCategoria(c, vaga.categoriaId)).find((v) => v.id === id);
      if (!linha) throw erros.naoEncontrado('Vaga não encontrada');
      if (linha.ocupada)
        throw erros.regraDeNegocio(
          `A vaga ${vaga.codigo} acabou de ser ocupada. Registre a saída antes de remover.`,
        );
      const resultado = await removerLinha(c, linha);
      await finalizar(c, {
        siteId: site.id,
        categoriaId: vaga.categoriaId,
        anterior,
        afetadas: { [resultado === 'EXCLUIDA' ? 'excluidas' : 'desativadas']: [vaga.codigo] },
        motivo: ator.contexto.motivo ?? 'Vaga removida',
        usuarioId: ator.usuarioId,
      });
      return { resultado, codigo: vaga.codigo };
    });
  },

  async reativar(ator: Ator, id: string) {
    const site = await obterSiteAtual();
    const { vaga } = await carregar(site.id, id);
    if (vaga.estado !== 'REMOVIDA') throw erros.regraDeNegocio(`A vaga ${vaga.codigo} não está removida.`);
    await comTransacao(ator.contexto, async (c) => {
      await categoriaAtiva(c, site.id, vaga.categoriaId);
      const anterior = await repo.capacidade(c, vaga.categoriaId);
      await c.query("UPDATE vagas SET situacao = 'ATIVA', desativada_em = NULL WHERE id = ?", [id]);
      await finalizar(c, {
        siteId: site.id,
        categoriaId: vaga.categoriaId,
        anterior,
        afetadas: { reativadas: [vaga.codigo] },
        motivo: ator.contexto.motivo ?? 'Vaga reativada',
        usuarioId: ator.usuarioId,
      });
    });
    return this.obter(id);
  },

  /**
   * Define a capacidade de uma categoria.
   * Aumentar: reativa vagas removidas da categoria e, se faltar, cria novas
   *           continuando a numeração do prefixo.
   * Reduzir:  remove primeiro as bloqueadas e depois as livres de código mais
   *           alto. Vagas ocupadas nunca são removidas.
   */
  async alterarCapacidade(ator: Ator, pedido: AlterarCapacidade): Promise<ResultadoCapacidade> {
    const site = await obterSiteAtual();
    if (!Number.isInteger(pedido.capacidade) || pedido.capacidade < 0 || pedido.capacidade > 5000) {
      throw erros.requisicaoInvalida('Capacidade deve ser um número inteiro entre 0 e 5000');
    }
    return comTransacao({ ...ator.contexto, motivo: pedido.motivo }, async (c) => {
      const cat = await categoriaAtiva(c, site.id, pedido.categoriaId);
      const vagas = await repo.vagasDaCategoria(c, cat.id);
      const emUso = vagas.filter((v) => v.situacao !== 'INATIVA');
      const anterior = emUso.length;
      const resultado: ResultadoCapacidade = {
        categoria: cat.nome,
        anterior,
        nova: pedido.capacidade,
        criadas: [],
        reativadas: [],
        excluidas: [],
        desativadas: [],
      };
      if (pedido.capacidade === anterior)
        throw erros.regraDeNegocio(`A capacidade de ${cat.nome} já é ${anterior}.`);

      if (pedido.capacidade > anterior) {
        let falta = pedido.capacidade - anterior;
        if (falta > LIMITE_VAGAS_POR_OPERACAO)
          throw erros.requisicaoInvalida(`Aumente no máximo ${LIMITE_VAGAS_POR_OPERACAO} vagas por vez`);
        const removidas = vagas
          .filter((v) => v.situacao === 'INATIVA')
          .sort((a, b) => compararCodigos(a.codigo, b.codigo));
        for (const v of removidas.slice(0, falta)) {
          await c.query("UPDATE vagas SET situacao = 'ATIVA', desativada_em = NULL WHERE id = ?", [v.id]);
          resultado.reativadas.push(v.codigo);
        }
        falta -= resultado.reativadas.length;
        if (falta > 0) {
          if (!pedido.prefixo?.trim()) {
            throw erros.requisicaoInvalida('Informe o prefixo para criar as novas vagas', [
              { campo: 'prefixo', mensagem: 'Ex.: A-' },
            ]);
          }
          const codigos = proximosCodigos(await repo.todosCodigos(c, site.id), pedido.prefixo, falta).map(
            validarCodigo,
          );
          await c.query('INSERT INTO vagas (id, site_id, codigo, setor, categoria_id) VALUES ?', [
            codigos.map((codigo) => [ulid(), site.id, codigo, pedido.setor?.trim() || null, cat.id]),
          ]);
          resultado.criadas = codigos;
        }
      } else {
        const sobra = anterior - pedido.capacidade;
        const removiveis = emUso
          .filter((v) => !v.ocupada)
          .sort((a, b) =>
            a.situacao === b.situacao
              ? compararCodigos(b.codigo, a.codigo)
              : a.situacao === 'MANUTENCAO'
                ? -1
                : 1,
          );
        if (removiveis.length < sobra) {
          const ocupadas = emUso.length - removiveis.length;
          throw erros.regraDeNegocio(
            `Não é possível reduzir para ${pedido.capacidade}: há ${ocupadas} vaga(s) ocupada(s) em ${cat.nome}. ` +
              `O mínimo agora é ${ocupadas}.`,
          );
        }
        for (const v of removiveis.slice(0, sobra)) {
          const r = await removerLinha(c, v);
          (r === 'EXCLUIDA' ? resultado.excluidas : resultado.desativadas).push(v.codigo);
        }
      }

      resultado.nova = await finalizar(c, {
        siteId: site.id,
        categoriaId: cat.id,
        anterior,
        afetadas: {
          criadas: resultado.criadas,
          reativadas: resultado.reativadas,
          excluidas: resultado.excluidas,
          desativadas: resultado.desativadas,
        },
        motivo: pedido.motivo,
        usuarioId: ator.usuarioId,
      });
      return resultado;
    });
  },

  // ---------- Categorias ----------
  async listarCategorias() {
    const site = await obterSiteAtual();
    return repo.listarCategorias(site.id);
  },

  async criarCategoria(ator: Ator, dados: { codigo: string; nome: string }) {
    const site = await obterSiteAtual();
    const codigo = dados.codigo
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(codigo))
      throw erros.requisicaoInvalida('Código de categoria inválido (ex.: CARRO, MOTO, VAN)');
    await comTransacao(ator.contexto, (c) =>
      c.query(
        'INSERT INTO categorias_veiculo (id, site_id, codigo, nome, ordem) SELECT ?, ?, ?, ?, COALESCE(MAX(ordem), 0) + 1 FROM categorias_veiculo WHERE site_id = ?',
        [ulid(), site.id, codigo, dados.nome.trim(), site.id],
      ),
    );
    return repo.listarCategorias(site.id);
  },

  async editarCategoria(ator: Ator, id: string, dados: { nome: string; ativo: boolean }) {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      const cat = await repo.travarCategoria(c, site.id, id);
      if (!cat) throw erros.naoEncontrado('Categoria não encontrada');
      await c.query('UPDATE categorias_veiculo SET nome = ?, ativo = ? WHERE id = ?', [
        dados.nome.trim(),
        dados.ativo,
        id,
      ]);
    });
    return repo.listarCategorias(site.id);
  },
};
