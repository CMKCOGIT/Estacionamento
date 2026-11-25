import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { IncidenteSeguranca, InventarioDados, ItemInventario } from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { comTransacao } from '../../db/transacao.js';
import { erros } from '../../http/erros.js';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { privacidadeService } from './privacidade.service.js';

/**
 * Incidentes de segurança com dados pessoais (LGPD art. 48) e inventário
 * dos dados guardados. Montado em /privacidade.
 */
export const incidentesRouter = Router();
const atender = exigirPermissao('lgpd.atender');

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const dataHora = z
  .string()
  .datetime({ offset: true, message: 'Data e hora inválidas' })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data e hora inválidas'));
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

function ler(l: RowDataPacket): IncidenteSeguranca {
  return {
    id: String(l.id),
    ocorridoEm: iso(l.ocorrido_em),
    detectadoEm: iso(l.detectado_em) ?? '',
    descricao: String(l.descricao),
    dadosAfetados: String(l.dados_afetados),
    titularesAfetados: l.titulares_afetados === null ? null : Number(l.titulares_afetados),
    gravidade: l.gravidade,
    medidas: (l.medidas as string | null) ?? null,
    comunicadoAnpdEm: iso(l.comunicado_anpd_em),
    comunicadoTitularesEm: iso(l.comunicado_titulares_em),
    status: l.status,
    registradoPor: (l.nome as string | null) ?? null,
    registradoEm: iso(l.registrado_em) ?? '',
    encerradoEm: iso(l.encerrado_em),
  };
}

const SELECT = `SELECT i.*, COALESCE(f.nome, u.login) AS nome FROM lgpd_incidentes i
  LEFT JOIN usuarios u ON u.id = i.registrado_por LEFT JOIN funcionarios f ON f.usuario_id = u.id`;

async function buscar(id: string): Promise<IncidenteSeguranca> {
  const [[l]] = await pool.query<RowDataPacket[]>(`${SELECT} WHERE i.id = ?`, [id]);
  if (!l) throw erros.naoEncontrado('Incidente não encontrado');
  return ler(l);
}

incidentesRouter.get('/incidentes', atender, async (_req, res) => {
  const site = await obterSiteAtual();
  const [linhas] = await pool.query<RowDataPacket[]>(
    `${SELECT} WHERE i.site_id = ? ORDER BY i.status = 'ABERTO' DESC, i.detectado_em DESC LIMIT 200`,
    [site.id],
  );
  res.set('Cache-Control', 'no-store').json({ itens: linhas.map(ler) });
});

const novo = z.object({
  ocorridoEm: dataHora.nullish(),
  detectadoEm: dataHora,
  descricao: z.string().trim().min(10, 'Descreva o que aconteceu (mínimo 10 caracteres)').max(2000),
  dadosAfetados: z.string().trim().min(3, 'Informe quais dados foram afetados').max(500),
  titularesAfetados: z.number().int().min(0).max(10_000_000).nullish(),
  gravidade: z.enum(['BAIXA', 'MEDIA', 'ALTA'], { message: 'Escolha a gravidade' }),
  medidas: textoOpcional(2000),
});

incidentesRouter.post('/incidentes', atender, async (req, res) => {
  const d = novo.parse(req.body);
  const detectado = new Date(d.detectadoEm);
  const ocorrido = d.ocorridoEm ? new Date(d.ocorridoEm) : null;
  if (detectado.getTime() > Date.now() + 5 * 60_000)
    throw erros.requisicaoInvalida('A data em que foi detectado não pode estar no futuro', [
      { campo: 'detectadoEm', mensagem: 'Data no futuro' },
    ]);
  if (ocorrido && ocorrido > detectado)
    throw erros.requisicaoInvalida('O incidente não pode ter ocorrido depois de ser detectado', [
      { campo: 'ocorridoEm', mensagem: 'Depois da detecção' },
    ]);
  const site = await obterSiteAtual();
  const id = ulid();
  await comTransacao(contextoAuditoria(req, 'incidente de segurança'), (c) =>
    c.query(
      `INSERT INTO lgpd_incidentes (id, site_id, ocorrido_em, detectado_em, descricao, dados_afetados,
         titulares_afetados, gravidade, medidas, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        site.id,
        ocorrido,
        detectado,
        d.descricao,
        d.dadosAfetados,
        d.titularesAfetados ?? null,
        d.gravidade,
        d.medidas,
        req.auth!.id,
      ],
    ),
  );
  res.status(201).json(await buscar(id));
});

const atualizacao = z.object({
  gravidade: z.enum(['BAIXA', 'MEDIA', 'ALTA']).optional(),
  medidas: textoOpcional(2000),
  titularesAfetados: z.number().int().min(0).max(10_000_000).nullish(),
  comunicadoAnpd: z.boolean().optional(),
  comunicadoTitulares: z.boolean().optional(),
  encerrar: z.boolean().optional(),
});

/** Acompanha o incidente (medidas, comunicações) e o encerra. Encerrado não muda mais. */
incidentesRouter.patch('/incidentes/:id', atender, async (req, res) => {
  const { id } = z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/) }).parse(req.params);
  const d = atualizacao.parse(req.body);
  const atual = await buscar(id);
  if (atual.status === 'ENCERRADO')
    throw erros.regraDeNegocio('Incidente encerrado não pode ser alterado. Registre um novo, se preciso.');
  const medidas = d.medidas !== undefined ? d.medidas : atual.medidas;
  if (d.encerrar && !medidas)
    throw erros.requisicaoInvalida('Para encerrar, registre as medidas tomadas', [
      { campo: 'medidas', mensagem: 'Obrigatório para encerrar' },
    ]);
  await comTransacao(contextoAuditoria(req, 'acompanhamento de incidente'), (c) =>
    c.query(
      `UPDATE lgpd_incidentes
          SET gravidade = COALESCE(?, gravidade),
              medidas = ?,
              titulares_afetados = IF(?, ?, titulares_afetados),
              comunicado_anpd_em = IF(? AND comunicado_anpd_em IS NULL, NOW(3), comunicado_anpd_em),
              comunicado_titulares_em = IF(? AND comunicado_titulares_em IS NULL, NOW(3), comunicado_titulares_em),
              status = IF(?, 'ENCERRADO', status),
              encerrado_em = IF(?, NOW(3), encerrado_em)
        WHERE id = ? AND status = 'ABERTO'`,
      [
        d.gravidade ?? null,
        medidas,
        d.titularesAfetados !== undefined,
        d.titularesAfetados ?? null,
        Boolean(d.comunicadoAnpd),
        Boolean(d.comunicadoTitulares),
        Boolean(d.encerrar),
        Boolean(d.encerrar),
        id,
      ],
    ),
  );
  res.json(await buscar(id));
});

/** Que dados pessoais o sistema guarda, para quê, por quanto tempo e quantos há hoje. */
incidentesRouter.get('/inventario', atender, async (_req, res) => {
  const site = await obterSiteAtual();
  const p = await privacidadeService.politicaRetencao(site.id);
  const contar = async (sql: string) => {
    const [[l]] = await pool.query<RowDataPacket[]>(sql, [site.id]);
    return Number(l?.n ?? 0);
  };
  const anos = (m: number) => (m % 12 === 0 ? `${m / 12} ano${m / 12 > 1 ? 's' : ''}` : `${m} meses`);
  const itens: ItemInventario[] = [
    {
      categoria: 'Veículos',
      dados: 'Placa, modelo e cor',
      finalidade: 'Controle de entrada e saída, cobrança e histórico de visitas',
      quemAcessa: 'Operadores, gerentes e administradores',
      retencao: `Placa anonimizada após ${anos(p.placasMeses)} sem visitas`,
      quantidade: await contar(
        "SELECT COUNT(*) AS n FROM veiculos WHERE site_id = ? AND NOT (placa_estrangeira AND placa LIKE 'AN%' AND CHAR_LENGTH(placa) = 10)",
      ),
    },
    {
      categoria: 'Permanências (tickets)',
      dados: 'Placa, horários, vaga, valores e quem atendeu',
      finalidade: 'Cobrança, comprovante e obrigações fiscais',
      quemAcessa: 'Operadores, gerentes e administradores',
      retencao: 'Valores guardados; a placa segue a regra dos veículos',
      quantidade: await contar('SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE site_id = ?'),
    },
    {
      categoria: 'Clientes cadastrados',
      dados: 'Nome, CPF/CNPJ, telefone e e-mail',
      finalidade: 'Clientes recorrentes e convênios',
      quemAcessa: 'Quem tem a permissão de clientes',
      retencao: 'Enquanto o cadastro estiver ativo',
      quantidade: await contar('SELECT COUNT(*) AS n FROM clientes WHERE site_id = ?'),
    },
    {
      categoria: 'Funcionários',
      dados: 'Nome, CPF, telefone, e-mail, cargo e login',
      finalidade: 'Acesso ao sistema e responsabilidade pelas operações',
      quemAcessa: 'Quem gerencia funcionários (o CPF não aparece nas listas)',
      retencao: 'Desativado não é apagado: o histórico precisa saber quem fez cada operação',
      quantidade: await contar('SELECT COUNT(*) AS n FROM funcionarios WHERE site_id = ?'),
    },
    {
      categoria: 'Acessos ao painel',
      dados: 'Endereço IP e navegador de cada login',
      finalidade: 'Segurança e investigação de acessos indevidos',
      quemAcessa: 'Administradores',
      retencao: `Apagados ${p.acessosPainelDias} dias após o fim da sessão`,
      quantidade: await contar('SELECT COUNT(*) AS n FROM sessoes_acesso WHERE site_id = ?'),
    },
    {
      categoria: 'Histórico de atividades',
      dados: 'Quem fez o quê e quando (pode incluir placas)',
      finalidade: 'Auditoria e prestação de contas',
      quemAcessa: 'Quem tem a permissão de auditoria (somente leitura)',
      retencao: `Apagado após ${anos(p.historicoMeses)}`,
      quantidade: await contar(
        'SELECT COUNT(*) AS n FROM historico_atividades WHERE site_id = ? OR site_id IS NULL',
      ),
    },
    {
      categoria: 'Solicitações de titulares',
      dados: 'Nome, contato e placa de quem pediu',
      finalidade: 'Atender e comprovar o atendimento aos direitos do titular',
      quemAcessa: 'Quem atende LGPD',
      retencao: `Identificação apagada ${p.solicitacoesMeses} meses após a conclusão`,
      quantidade: await contar('SELECT COUNT(*) AS n FROM lgpd_solicitacoes WHERE site_id = ?'),
    },
  ];
  const corpo: InventarioDados = {
    geradoEm: new Date().toISOString(),
    itens,
    politicaUrl: env.PUBLIC_PWA_URL ? `${env.PUBLIC_PWA_URL.replace(/\/$/, '')}/privacidade` : null,
  };
  res.set('Cache-Control', 'no-store').json(corpo);
});
