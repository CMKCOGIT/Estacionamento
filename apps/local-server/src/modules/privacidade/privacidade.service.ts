import { createHash, randomBytes } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import {
  formatarPlaca,
  mascararCpf,
  normalizarPlaca,
  POLITICA_RETENCAO_PADRAO,
  PRAZO_SOLICITACAO_DIAS,
  type EncarregadoDados,
  type NovaSolicitacaoLgpd,
  type PoliticaRetencao,
  type RelatorioTitular,
  type ResultadoAnonimizacao,
  type ResultadoRetencao,
  type SolicitacaoLgpd,
  type StatusSolicitacaoLgpd,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { registrarAtividade } from '../../db/atividades.js';
import { pool, type Conexao } from '../../db/pool.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { AppError, erros } from '../../http/erros.js';
import { publicarSite, registrarEvento } from '../../sync/outbox.js';

/**
 * LGPD no servidor local (docs/LGPD.md):
 *  - relatório e portabilidade dos dados de um titular (pela placa);
 *  - anonimização: a placa some do veículo, dos tickets, do histórico de
 *    auditoria, da fila de sincronização e da nuvem; os valores pagos ficam
 *    (obrigação fiscal), sem ligação com a pessoa;
 *  - registro das solicitações dos titulares, com protocolo e prazo;
 *  - política de retenção aplicada automaticamente;
 *  - contato do encarregado, divulgado no app do cliente.
 */
export interface Ator {
  usuarioId: string;
  contexto: ContextoAuditoria;
  ip: string | null;
}

const CHAVE_RETENCAO = 'retencao';
const CHAVE_ENCARREGADO = 'encarregado_dados';
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const hashPlaca = (placa: string) => createHash('sha256').update(`placa:${placa}`).digest('hex');
const json = <T>(v: unknown): T | null =>
  v === null || v === undefined ? null : ((typeof v === 'string' ? JSON.parse(v) : v) as T);

/** Pseudônimo aleatório (não derivado da placa: não dá para voltar à placa). */
function pseudonimo(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `AN${[...randomBytes(8)].map((b) => alfabeto[b % alfabeto.length]).join('')}`;
}

async function lerConfig<T>(c: Conexao | typeof pool, siteId: string, chave: string): Promise<T | null> {
  const [[l]] = await c.query<RowDataPacket[]>(
    'SELECT valor FROM configuracoes WHERE site_id = ? AND chave = ?',
    [siteId, chave],
  );
  return l ? json<T>(l.valor) : null;
}

async function gravarConfig(
  c: Conexao,
  siteId: string,
  chave: string,
  valor: unknown,
  descricao: string,
  usuarioId: string,
) {
  await c.query(
    `INSERT INTO configuracoes (site_id, chave, valor, descricao, atualizado_por) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_por = VALUES(atualizado_por)`,
    [siteId, chave, JSON.stringify(valor), descricao, usuarioId],
  );
}

/** Finalidades e bases legais (art. 7º) do que o estacionamento trata. */
const FINALIDADES: RelatorioTitular['finalidades'] = [
  {
    finalidade: 'Controle de entrada, permanência e saída do veículo e cobrança da estadia',
    baseLegal: 'Execução de contrato (art. 7º, V)',
  },
  {
    finalidade: 'Registros financeiros e fiscais dos pagamentos',
    baseLegal: 'Cumprimento de obrigação legal (art. 7º, II)',
  },
  {
    finalidade: 'Consulta do próprio ticket pelo app do cliente (link do QR Code)',
    baseLegal: 'Execução de contrato (art. 7º, V)',
  },
  {
    finalidade: 'Segurança e auditoria das operações (histórico de atividades)',
    baseLegal: 'Legítimo interesse (art. 7º, IX) e exercício regular de direitos (art. 7º, VI)',
  },
];

export const privacidadeService = {
  // ------------------------------------------------------------------ retenção
  async politicaRetencao(siteId?: string): Promise<PoliticaRetencao> {
    const id = siteId ?? (await obterSiteAtual()).id;
    return {
      ...POLITICA_RETENCAO_PADRAO,
      ...((await lerConfig<Partial<PoliticaRetencao>>(pool, id, CHAVE_RETENCAO)) ?? {}),
    };
  },

  async definirPoliticaRetencao(ator: Ator, p: PoliticaRetencao): Promise<PoliticaRetencao> {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, (c) =>
      gravarConfig(
        c,
        site.id,
        CHAVE_RETENCAO,
        p,
        'Política de retenção de dados pessoais (LGPD)',
        ator.usuarioId,
      ),
    );
    return this.politicaRetencao(site.id);
  },

  // --------------------------------------------------------------- encarregado
  async encarregado(siteId?: string): Promise<EncarregadoDados> {
    const id = siteId ?? (await obterSiteAtual()).id;
    return {
      nome: null,
      contato: null,
      ...((await lerConfig<EncarregadoDados>(pool, id, CHAVE_ENCARREGADO)) ?? {}),
    };
  },

  async definirEncarregado(ator: Ator, e: EncarregadoDados): Promise<EncarregadoDados> {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      await gravarConfig(
        c,
        site.id,
        CHAVE_ENCARREGADO,
        e,
        'Encarregado pelo tratamento de dados (LGPD art. 41)',
        ator.usuarioId,
      );
      await publicarSite(c, site.id); // o app do cliente mostra o contato
    });
    return this.encarregado(site.id);
  },

  // ----------------------------------------------------------------- relatório
  /** Acesso/portabilidade: tudo que o estacionamento tem sobre ESTA placa, e só isso. */
  async relatorioTitular(ator: Ator, placaInformada: string): Promise<RelatorioTitular> {
    const site = await obterSiteAtual();
    const placa = normalizarPlaca(placaInformada);
    const [[v]] = await pool.query<RowDataPacket[]>(
      `SELECT v.*, c.nome AS categoria FROM veiculos v JOIN categorias_veiculo c ON c.id = v.categoria_id
        WHERE v.site_id = ? AND v.placa = ?`,
      [site.id, placa],
    );
    const [estadias] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.numero, s.status, s.entrada_em, s.saida_em, s.valor_final_centavos,
              (SELECT COALESCE(SUM(p.valor_centavos), 0) FROM pagamentos p WHERE p.sessao_id = s.id AND p.status = 'CONFIRMADO') AS pago,
              (SELECT GROUP_CONCAT(DISTINCT f.nome ORDER BY f.nome SEPARATOR ', ') FROM pagamentos p
                 JOIN formas_pagamento f ON f.codigo = p.forma_codigo WHERE p.sessao_id = s.id AND p.status = 'CONFIRMADO') AS formas,
              (SELECT MAX(k.expira_em) FROM sessao_tokens k WHERE k.sessao_id = s.id AND k.revogado_em IS NULL) AS link_ate
         FROM sessoes_estacionamento s WHERE s.site_id = ? AND s.placa = ? ORDER BY s.entrada_em DESC`,
      [site.id, placa],
    );
    const [clientes] = v
      ? await pool.query<RowDataPacket[]>(
          `SELECT c.nome, c.documento, c.telefone, c.email FROM cliente_veiculos cv JOIN clientes c ON c.id = cv.cliente_id
            WHERE cv.veiculo_id = ? AND c.anonimizado_em IS NULL`,
          [v.id],
        )
      : [[] as RowDataPacket[]];
    const [[s]] = await pool.query<RowDataPacket[]>('SELECT nome, documento FROM sites WHERE id = ?', [
      site.id,
    ]);
    const politica = await this.politicaRetencao(site.id);
    const ultima = (v?.ultima_visita_em as Date | null) ?? null;
    const emAndamento = estadias.some((e) => e.status === 'ABERTA');
    const naNuvem = estadias.filter(
      (e) => e.status === 'ABERTA' || (e.link_ate && (e.link_ate as Date).getTime() > Date.now()),
    );

    await registrarAtividade({
      acao: 'lgpd.relatorio_titular',
      siteId: site.id,
      usuarioId: ator.usuarioId,
      entidade: 'titular',
      entidadeId: hashPlaca(placa).slice(0, 64),
      dados: { estadias: estadias.length },
      ip: ator.ip,
      correlacaoId: ator.contexto.correlacaoId ?? null,
    });
    return {
      geradoEm: new Date().toISOString(),
      identificador: { tipo: 'PLACA', valor: formatarPlaca(placa) },
      controlador: {
        nome: String(s?.nome ?? ''),
        documento: (s?.documento as string | null) ?? null,
        encarregado: await this.encarregado(site.id),
      },
      veiculo: v
        ? {
            placa: formatarPlaca(String(v.placa)),
            categoria: String(v.categoria),
            marca: (v.marca as string | null) ?? null,
            modelo: (v.modelo as string | null) ?? null,
            cor: (v.cor as string | null) ?? null,
            cadastradoEm: iso(v.criado_em)!,
            primeiraVisitaEm: iso(v.primeira_visita_em),
            ultimaVisitaEm: iso(v.ultima_visita_em),
          }
        : null,
      // Documento mascarado: confirma que é o titular sem expor o número inteiro
      clientesVinculados: clientes.map((c) => ({
        nome: String(c.nome),
        documento: mascararCpf(c.documento as string | null),
        telefone: (c.telefone as string | null) ?? null,
        email: (c.email as string | null) ?? null,
      })),
      // Sem nome de operadores, IPs ou dados de outras pessoas
      estadias: estadias.map((e) => ({
        numero: String(e.numero),
        situacao: String(e.status),
        entradaEm: iso(e.entrada_em)!,
        saidaEm: iso(e.saida_em),
        valorFinalCentavos: e.valor_final_centavos === null ? null : Number(e.valor_final_centavos),
        pagoCentavos: Number(e.pago),
        formasPagamento: e.formas ? String(e.formas).split(', ') : [],
      })),
      compartilhamento: naNuvem.length
        ? [
            {
              destinatario: 'Servidor externo do próprio estacionamento (app do cliente)',
              finalidade: 'Permitir a consulta do ticket pelo link do QR Code',
              dados:
                'Placa, horários, vaga, valor, total pago e a tarifa do ticket (sem formas de pagamento)',
              ate:
                naNuvem
                  .map((e) => iso(e.link_ate))
                  .filter(Boolean)
                  .sort()
                  .at(-1) ?? null,
            },
          ]
        : [],
      finalidades: FINALIDADES,
      retencao: {
        anonimizacaoPrevistaEm: ultima
          ? new Date(ultima.getTime() + politica.placasMeses * 30.44 * 86_400_000).toISOString()
          : null,
        observacao: `A placa é anonimizada ${politica.placasMeses} meses depois da última visita. Valores pagos ficam guardados sem a placa, pelo prazo das obrigações fiscais.`,
      },
      emAndamento,
    };
  },

  // ------------------------------------------------------------- anonimização
  async anonimizarPlaca(ator: Ator, placaInformada: string, motivo: string): Promise<ResultadoAnonimizacao> {
    const site = await obterSiteAtual();
    const placa = normalizarPlaca(placaInformada);
    const [[v]] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM veiculos WHERE site_id = ? AND placa = ?',
      [site.id, placa],
    );
    const [[sessoes]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE site_id = ? AND placa = ?',
      [site.id, placa],
    );
    if (!v && !Number(sessoes?.n)) throw erros.naoEncontrado('Nenhum dado encontrado para esta placa.');
    const r = await comTransacao({ ...ator.contexto, motivo, retencao: true }, (c) =>
      anonimizar(c, site.id, placa, v?.id ?? null),
    );
    await registrarAtividade({
      acao: 'lgpd.anonimizacao',
      siteId: site.id,
      usuarioId: ator.usuarioId,
      entidade: 'titular',
      entidadeId: hashPlaca(placa),
      dados: { ...r, pseudonimo: undefined },
      motivo,
      ip: ator.ip,
      correlacaoId: ator.contexto.correlacaoId ?? null,
    });
    return r;
  },

  // -------------------------------------------------------------- solicitações
  async listarSolicitacoes(): Promise<SolicitacaoLgpd[]> {
    const site = await obterSiteAtual();
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT *, (status NOT IN ('ATENDIDA', 'INDEFERIDA') AND prazo_em < NOW(3)) AS vencida
         FROM lgpd_solicitacoes WHERE site_id = ? ORDER BY (status IN ('ATENDIDA', 'INDEFERIDA')), prazo_em LIMIT 200`,
      [site.id],
    );
    return l.map(lerSolicitacao);
  },

  async registrarSolicitacao(ator: Ator, d: NovaSolicitacaoLgpd): Promise<SolicitacaoLgpd> {
    const site = await obterSiteAtual();
    const id = ulid();
    const placa = d.placa ? normalizarPlaca(d.placa) : null;
    await comTransacao(ator.contexto, async (c) => {
      const [[n]] = await c.query<RowDataPacket[]>(
        'SELECT COUNT(*) + 1 AS n FROM lgpd_solicitacoes WHERE site_id = ? AND YEAR(recebida_em) = YEAR(NOW())',
        [site.id],
      );
      const protocolo = `LGPD-${new Date().getFullYear()}-${String(n?.n ?? 1).padStart(4, '0')}`;
      await c.query(
        `INSERT INTO lgpd_solicitacoes (id, site_id, protocolo, tipo, titular_nome, titular_contato, identificador, identificador_hash,
           descricao, prazo_em, registrada_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3) + INTERVAL ? DAY, ?)`,
        [
          id,
          site.id,
          protocolo,
          d.tipo,
          d.titularNome?.trim() || null,
          d.titularContato?.trim() || null,
          placa,
          placa ? hashPlaca(placa) : null,
          d.descricao?.trim() || null,
          PRAZO_SOLICITACAO_DIAS,
          ator.usuarioId,
        ],
      );
    });
    return (await this.listarSolicitacoes()).find((s) => s.id === id)!;
  },

  async atualizarSolicitacao(
    ator: Ator,
    id: string,
    d: { status: StatusSolicitacaoLgpd; resposta?: string | null },
  ): Promise<SolicitacaoLgpd> {
    const site = await obterSiteAtual();
    const concluir = d.status === 'ATENDIDA' || d.status === 'INDEFERIDA';
    if (concluir && !d.resposta?.trim())
      throw erros.regraDeNegocio('Registre a resposta dada ao titular para concluir a solicitação.');
    await comTransacao(ator.contexto, async (c) => {
      const [[s]] = await c.query<RowDataPacket[]>(
        'SELECT status FROM lgpd_solicitacoes WHERE id = ? AND site_id = ? FOR UPDATE',
        [id, site.id],
      );
      if (!s) throw erros.naoEncontrado('Solicitação não encontrada');
      if (s.status === 'ATENDIDA' || s.status === 'INDEFERIDA')
        throw new AppError(409, 'CONFLITO', 'Esta solicitação já foi concluída.');
      await c.query(
        `UPDATE lgpd_solicitacoes SET status = ?, resposta = COALESCE(?, resposta),
           concluida_em = IF(?, NOW(3), NULL), concluida_por = IF(?, ?, NULL) WHERE id = ?`,
        [d.status, d.resposta?.trim() || null, concluir, concluir, ator.usuarioId, id],
      );
    });
    return (await this.listarSolicitacoes()).find((s) => s.id === id)!;
  },

  // ------------------------------------------------------- rotina de retenção
  /** Aplica a política de retenção (roda todo dia; também pelo painel). */
  async executarRetencao(usuarioId: string | null = null): Promise<ResultadoRetencao> {
    const site = await obterSiteAtual();
    const p = await this.politicaRetencao(site.id);
    const r: ResultadoRetencao = {
      executadaEm: new Date().toISOString(),
      veiculosAnonimizados: 0,
      acessosApagados: 0,
      historicoApagado: 0,
      solicitacoesRedigidas: 0,
    };
    // Placas sem visita há mais que o prazo (e sem ticket aberto)
    const [antigos] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.placa FROM veiculos v
        WHERE v.site_id = ? AND v.placa NOT LIKE 'AN%' AND COALESCE(v.ultima_visita_em, v.criado_em) < NOW(3) - INTERVAL ? MONTH
          AND NOT EXISTS (SELECT 1 FROM sessoes_estacionamento s WHERE s.veiculo_id = v.id AND s.status = 'ABERTA')
        LIMIT 500`,
      [site.id, p.placasMeses],
    );
    for (const v of antigos) {
      await comTransacao({ usuarioId, motivo: 'Política de retenção (LGPD)', retencao: true }, (c) =>
        anonimizar(c, site.id, String(v.placa), String(v.id)),
      );
      r.veiculosAnonimizados++;
    }
    await comTransacao({ usuarioId, motivo: 'Política de retenção (LGPD)', retencao: true }, async (c) => {
      const [a] = await c.query<ResultSetHeader>(
        'DELETE FROM sessoes_acesso WHERE encerrada_em IS NOT NULL AND encerrada_em < NOW(3) - INTERVAL ? DAY',
        [p.acessosPainelDias],
      );
      r.acessosApagados = a.affectedRows;
      const [h] = await c.query<ResultSetHeader>(
        'DELETE FROM historico_atividades WHERE criado_em < NOW(3) - INTERVAL ? MONTH LIMIT 50000',
        [p.historicoMeses],
      );
      r.historicoApagado = h.affectedRows;
      const [s] = await c.query<ResultSetHeader>(
        `UPDATE lgpd_solicitacoes SET titular_nome = NULL, titular_contato = NULL, identificador = NULL,
           descricao = NULL, dados_removidos_em = NOW(3)
          WHERE site_id = ? AND concluida_em < NOW(3) - INTERVAL ? MONTH AND dados_removidos_em IS NULL`,
        [site.id, p.solicitacoesMeses],
      );
      r.solicitacoesRedigidas = s.affectedRows;
    });
    await registrarAtividade({ acao: 'lgpd.retencao', siteId: site.id, usuarioId, dados: { ...r } });
    await gravarUltimaRetencao(site.id, r);
    return r;
  },

  async ultimaRetencao(): Promise<ResultadoRetencao | null> {
    const site = await obterSiteAtual();
    return lerConfig<ResultadoRetencao>(pool, site.id, 'retencao_ultima_execucao');
  },
};

async function gravarUltimaRetencao(siteId: string, r: ResultadoRetencao) {
  await pool.query(
    `INSERT INTO configuracoes (site_id, chave, valor, descricao) VALUES (?, 'retencao_ultima_execucao', ?, 'Última execução da retenção')
     ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
    [siteId, JSON.stringify(r)],
  );
}

function lerSolicitacao(l: RowDataPacket): SolicitacaoLgpd {
  return {
    id: String(l.id),
    protocolo: String(l.protocolo),
    tipo: l.tipo,
    titularNome: (l.titular_nome as string | null) ?? null,
    titularContato: (l.titular_contato as string | null) ?? null,
    identificador: l.identificador ? formatarPlaca(String(l.identificador)) : null,
    descricao: (l.descricao as string | null) ?? null,
    status: l.status,
    recebidaEm: iso(l.recebida_em)!,
    prazoEm: iso(l.prazo_em)!,
    vencida: Boolean(Number(l.vencida)),
    concluidaEm: iso(l.concluida_em),
    resposta: (l.resposta as string | null) ?? null,
  };
}

/**
 * Núcleo da anonimização (dentro de uma transação com @app_retencao = 1).
 * Troca a placa por um pseudônimo aleatório em tudo que a guarda; apaga
 * marca/modelo/cor e o vínculo com clientes; tira os tickets da nuvem.
 * Ticket em andamento impede (os dados são necessários para a cobrança).
 */
async function anonimizar(
  c: Conexao,
  siteId: string,
  placa: string,
  veiculoId: string | null,
): Promise<ResultadoAnonimizacao> {
  const [[aberto]] = await c.query<RowDataPacket[]>(
    "SELECT numero FROM sessoes_estacionamento WHERE site_id = ? AND placa = ? AND status = 'ABERTA' LIMIT 1",
    [siteId, placa],
  );
  if (aberto)
    throw erros.regraDeNegocio(
      `O veículo está no estacionamento (ticket nº ${aberto.numero}). Anonimize depois da saída: os dados são necessários para a cobrança.`,
    );
  const novo = pseudonimo();
  const r: ResultadoAnonimizacao = {
    pseudonimo: novo,
    estadias: 0,
    registrosDeHistorico: 0,
    clientesAnonimizados: 0,
    removidosDaNuvem: 0,
  };

  if (veiculoId) {
    await c.query(
      `UPDATE veiculos SET placa = ?, placa_estrangeira = TRUE, marca = NULL, modelo = NULL, cor = NULL, observacoes = NULL
        WHERE id = ?`,
      [novo, veiculoId],
    );
    // Clientes ligados só a este veículo: dados pessoais removidos
    const [cs] = await c.query<RowDataPacket[]>(
      `SELECT cv.cliente_id FROM cliente_veiculos cv WHERE cv.veiculo_id = ?
          AND NOT EXISTS (SELECT 1 FROM cliente_veiculos o WHERE o.cliente_id = cv.cliente_id AND o.veiculo_id <> cv.veiculo_id)`,
      [veiculoId],
    );
    await c.query('DELETE FROM cliente_veiculos WHERE veiculo_id = ?', [veiculoId]);
    for (const k of cs) {
      const [u] = await c.query<ResultSetHeader>(
        `UPDATE clientes SET nome = 'Titular anonimizado', documento = NULL, telefone = NULL, email = NULL, observacoes = NULL,
           ativo = FALSE, anonimizado_em = NOW(3) WHERE id = ? AND anonimizado_em IS NULL`,
        [k.cliente_id],
      );
      r.clientesAnonimizados += u.affectedRows;
    }
  }

  const [sessoes] = await c.query<RowDataPacket[]>(
    'SELECT id FROM sessoes_estacionamento WHERE site_id = ? AND placa = ? FOR UPDATE',
    [siteId, placa],
  );
  if (sessoes.length) {
    const ids = sessoes.map((s) => String(s.id));
    await c.query('UPDATE sessoes_estacionamento SET placa = ? WHERE id IN (?)', [novo, ids]);
    r.estadias = ids.length;
    // O link do cliente para de funcionar e o ticket sai da nuvem
    const [vis] = await c.query<RowDataPacket[]>(
      `SELECT DISTINCT sessao_id FROM sessao_tokens WHERE sessao_id IN (?) AND revogado_em IS NULL
          AND (expira_em IS NULL OR expira_em > NOW(3) - INTERVAL 1 HOUR)`,
      [ids],
    );
    const [[u]] = await c.query<RowDataPacket[]>(
      'SELECT COALESCE(@app_usuario_id, (SELECT id FROM usuarios ORDER BY criado_em LIMIT 1)) AS id',
    );
    await c.query(
      `UPDATE sessao_tokens SET revogado_em = NOW(3), revogado_por = ?, motivo_revogacao = 'Anonimização (LGPD)'
        WHERE sessao_id IN (?) AND revogado_em IS NULL`,
      [u?.id, ids],
    );
    for (const s of vis) {
      await registrarEvento(c, {
        siteId,
        tipo: 'ticket.removido',
        agregadoTipo: 'ticket',
        agregadoId: String(s.sessao_id),
        payload: { tipo: 'ticket_removido', ticketId: String(s.sessao_id) },
      });
      r.removidosDaNuvem++;
    }
    await c.query("DELETE FROM sync_marcas WHERE tipo = 'ticket' AND agregado_id IN (?)", [ids]);
  }

  // A placa também sai das trilhas: histórico de auditoria e fila de sincronização
  const formas = [placa, formatarPlaca(placa)];
  for (const f of [...new Set(formas)]) {
    const [h] = await c.query<ResultSetHeader>(
      `UPDATE historico_atividades
          SET dados_anteriores = IF(dados_anteriores IS NULL, NULL, CAST(REPLACE(CAST(dados_anteriores AS CHAR), ?, ?) AS JSON)),
              dados_novos = IF(dados_novos IS NULL, NULL, CAST(REPLACE(CAST(dados_novos AS CHAR), ?, ?) AS JSON)),
              motivo = REPLACE(motivo, ?, ?)
        WHERE (site_id = ? OR site_id IS NULL)
          AND (INSTR(CAST(dados_anteriores AS CHAR), ?) > 0 OR INSTR(CAST(dados_novos AS CHAR), ?) > 0 OR INSTR(motivo, ?) > 0)`,
      [f, novo, f, novo, f, novo, siteId, f, f, f],
    );
    r.registrosDeHistorico += h.affectedRows;
    await c.query(
      `UPDATE sync_outbox SET payload = CAST(REPLACE(CAST(payload AS CHAR), ?, ?) AS JSON)
        WHERE site_id = ? AND INSTR(CAST(payload AS CHAR), ?) > 0`,
      [`"${f}"`, `"${novo}"`, siteId, `"${f}"`],
    );
  }
  return r;
}
