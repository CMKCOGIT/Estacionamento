/**
 * FERRAMENTA DE DESENVOLVIMENTO — copia do banco LOCAL para o banco da NUVEM
 * só o que a API pública mostra (estacionamento, vagas livres, tarifas em
 * vigor e tickets recentes com o HASH dos tokens).
 *
 * Serve para testar o PWA de ponta a ponta antes da sincronização automática
 * (servidor local → nuvem), que vai alimentar estas mesmas tabelas. Nunca
 * copia usuários, operadores, caixa ou pagamentos individuais.
 *
 *   npm run espelhar:local -w @estacionamento/cloud-api              (uma vez)
 *   npm run espelhar:local -w @estacionamento/cloud-api -- --repetir (a cada 15 s)
 */
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { descreverCondicao, descreverRegra, type RegraTarifa } from '@estacionamento/shared';
import { env } from '../src/config/env.js';
import { fecharPool, pool } from '../src/db/pool.js';
import { linhasPublicasDaRegra } from '../src/modules/publico/texto.js';

const LOCAL = {
  host: process.env.LOCAL_DB_HOST ?? env.DB_HOST,
  port: Number(process.env.LOCAL_DB_PORT ?? env.DB_PORT),
  user: process.env.LOCAL_DB_USER ?? env.DB_USER,
  password: process.env.LOCAL_DB_PASSWORD ?? env.DB_PASSWORD,
  database: process.env.LOCAL_DB_NAME ?? '',
};
if (!LOCAL.database)
  throw new Error('Informe LOCAL_DB_NAME (banco do servidor local de origem) no .env da API externa.');
if (LOCAL.database === env.DB_NAME) throw new Error('LOCAL_DB_NAME e DB_NAME são o mesmo banco.');

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = <T>(v: unknown): T | null =>
  v === null || v === undefined ? null : ((typeof v === 'string' ? JSON.parse(v) : v) as T);
const regraDaLinha = (l: RowDataPacket): Required<RegraTarifa> => ({
  toleranciaMin: Number(l.tolerancia_min),
  primeiraHoraCentavos: Number(l.primeira_hora_centavos),
  horaAdicionalCentavos: Number(l.hora_adicional_centavos),
  fracaoMin: n(l.fracao_min),
  fracaoCentavos: n(l.fracao_centavos),
  carenciaMin: Number(l.carencia_min ?? 0),
  diariaMaximaCentavos: n(l.diaria_maxima_centavos),
  diariaCentavos: n(l.diaria_centavos),
  valorFixoCentavos: n(l.valor_fixo_centavos),
});
const hhmm = (v: unknown) => (v ? String(v).slice(0, 5) : null);

async function espelhar() {
  const local = await mysql.createConnection({ ...LOCAL, timezone: 'Z' });
  try {
    const [sites] = await local.query<RowDataPacket[]>(
      `SELECT s.id, s.slug, s.nome, s.endereco, s.telefone, c.valor AS politica
         FROM sites s LEFT JOIN configuracoes c ON c.site_id = s.id AND c.chave = 'acesso_cliente'
        WHERE s.ativo`,
    );
    for (const s of sites) {
      // Política de encerramento do link (Configurações → Link do cliente; padrão 24h)
      const horas = json<{ horasAposSaida?: number }>(s.politica)?.horasAposSaida ?? 24;
      await pool.query(
        `INSERT INTO sites_publicos (id, slug, nome, endereco, telefone, horas_acesso_apos_saida, sincronizado_em)
         VALUES (?, ?, ?, ?, ?, ?, NOW(3))
         ON DUPLICATE KEY UPDATE slug = VALUES(slug), nome = VALUES(nome), endereco = VALUES(endereco), telefone = VALUES(telefone),
                                 horas_acesso_apos_saida = VALUES(horas_acesso_apos_saida), sincronizado_em = NOW(3)`,
        [s.id, s.slug, s.nome, s.endereco, s.telefone, horas],
      );

      // Vagas: total = em uso (livres + ocupadas + bloqueadas); livres = ativas sem veículo
      const [disp] = await local.query<RowDataPacket[]>(
        `SELECT c.id, c.nome, c.ordem,
                SUM(v.situacao IN ('ATIVA', 'MANUTENCAO')) AS total,
                SUM(v.situacao = 'ATIVA' AND NOT EXISTS (SELECT 1 FROM sessoes_estacionamento x WHERE x.vaga_ocupada_id = v.id)) AS livres
           FROM categorias_veiculo c JOIN vagas v ON v.categoria_id = c.id
          WHERE c.site_id = ? AND c.ativo GROUP BY c.id, c.nome, c.ordem`,
        [s.id],
      );
      await pool.query('DELETE FROM disponibilidade_publica WHERE site_id = ?', [s.id]);
      for (const d of disp) {
        await pool.query(
          'INSERT INTO disponibilidade_publica (site_id, categoria_id, categoria, ordem, total, livres, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, NOW(3))',
          [s.id, d.id, d.nome, d.ordem, Number(d.total), Number(d.livres)],
        );
      }

      // Tarifas da tabela em vigor (só as ativas)
      const [regras] = await local.query<RowDataPacket[]>(
        `SELECT r.*, c.nome AS categoria, c.ordem AS cat_ordem, t.vigente_desde
           FROM tarifa_regras r JOIN tabelas_tarifa t ON t.id = r.tabela_id JOIN categorias_veiculo c ON c.id = r.categoria_id
          WHERE r.ativo AND r.tabela_id = (SELECT tv.id FROM tabelas_tarifa tv WHERE tv.site_id = ? AND tv.status = 'PUBLICADA'
                                            AND tv.vigente_desde <= NOW(3) ORDER BY tv.vigente_desde DESC, tv.versao DESC LIMIT 1)`,
        [s.id],
      );
      await pool.query('DELETE FROM tarifas_publicas WHERE site_id = ?', [s.id]);
      for (const r of regras) {
        const especial = r.tipo === 'ESPECIAL';
        const condicao = !especial
          ? null
          : r.aplicacao === 'MANUAL'
            ? 'Informe no caixa (convênio ou evento)'
            : descreverCondicao({
                diasSemana: n(r.dias_semana),
                horaInicio: hhmm(r.hora_inicio),
                horaFim: hhmm(r.hora_fim),
              });
        await pool.query(
          'INSERT INTO tarifas_publicas (id, site_id, categoria, ordem, nome, especial, condicao, linhas, vigente_desde) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            r.id,
            s.id,
            r.categoria,
            Number(r.cat_ordem) * 100 + Number(r.ordem) + (especial ? 50 : 0),
            especial ? r.nome : 'Padrão',
            especial,
            condicao,
            JSON.stringify(linhasPublicasDaRegra(regraDaLinha(r))),
            r.vigente_desde,
          ],
        );
      }

      // Tickets: abertos e os encerrados cujo link ainda funciona (política de encerramento)
      const [tickets] = await local.query<RowDataPacket[]>(
        `SELECT s.*, c.nome AS categoria, v.codigo AS vaga_codigo,
                r.tolerancia_min, r.primeira_hora_centavos, r.hora_adicional_centavos, r.fracao_min, r.fracao_centavos,
                r.carencia_min, r.diaria_maxima_centavos, r.diaria_centavos, r.valor_fixo_centavos,
                (SELECT COALESCE(SUM(p.valor_centavos), 0) FROM pagamentos p WHERE p.sessao_id = s.id AND p.status = 'CONFIRMADO') AS pago,
                (SELECT MAX(k.expira_em) FROM sessao_tokens k WHERE k.sessao_id = s.id) AS expira_em
           FROM sessoes_estacionamento s
           JOIN categorias_veiculo c ON c.id = s.categoria_id
           JOIN tarifa_regras r ON r.id = s.tarifa_regra_id
           LEFT JOIN vagas v ON v.id = s.vaga_id
          WHERE s.site_id = ? AND (s.status = 'ABERTA'
                -- recém-encerrados/cancelados sempre vão (para a nuvem saber que acabou)
                OR COALESCE(s.saida_em, s.cancelado_em) >= NOW(3) - INTERVAL 1 HOUR
                OR EXISTS (SELECT 1 FROM sessao_tokens k WHERE k.sessao_id = s.id AND k.revogado_em IS NULL AND k.expira_em > NOW(3)))`,
        [s.id],
      );
      for (const t of tickets) {
        const aplicada = json<{ regra: RegraTarifa; tipo: string; nome: string }>(t.tarifa_aplicada);
        const regra = aplicada?.regra ?? regraDaLinha(t);
        const situacao =
          t.status === 'ABERTA' ? 'ESTACIONADO' : t.status === 'ENCERRADA' ? 'ENCERRADO' : 'CANCELADO';
        const expira =
          t.status === 'ABERTA' ? null : (t.expira_em ?? new Date((t.saida_em ?? t.cancelado_em).getTime()));
        await pool.query(
          `INSERT INTO tickets_publicos (id, site_id, numero, placa, categoria, vaga, modalidade, situacao, entrada_em, saida_em, regra,
                                         tarifa_descricao, tarifa_nome, valor_final_centavos, itens_final, pago_centavos, acesso_expira_em, sincronizado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
           ON DUPLICATE KEY UPDATE placa = VALUES(placa), categoria = VALUES(categoria), vaga = VALUES(vaga), situacao = VALUES(situacao),
             saida_em = VALUES(saida_em), tarifa_nome = VALUES(tarifa_nome), valor_final_centavos = VALUES(valor_final_centavos), itens_final = VALUES(itens_final),
             pago_centavos = VALUES(pago_centavos), acesso_expira_em = VALUES(acesso_expira_em), sincronizado_em = NOW(3)`,
          [
            t.id,
            s.id,
            t.numero,
            t.placa,
            t.categoria,
            t.vaga_codigo,
            t.modalidade,
            situacao,
            t.entrada_em,
            t.saida_em,
            JSON.stringify(regra),
            descreverRegra(regra, t.modalidade),
            aplicada?.tipo === 'ESPECIAL' ? aplicada.nome : 'Padrão',
            t.valor_final_centavos,
            t.status === 'ENCERRADA'
              ? JSON.stringify(json<{ itens: unknown[] }>(t.calculo_detalhe)?.itens ?? [])
              : null,
            Number(t.pago),
            expira,
          ],
        );
        const [tokens] = await local.query<RowDataPacket[]>(
          'SELECT token_hash, revogado_em FROM sessao_tokens WHERE sessao_id = ?',
          [t.id],
        );
        for (const k of tokens) {
          await pool.query(
            'INSERT INTO tickets_tokens (token_hash, ticket_id, revogado_em) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE revogado_em = VALUES(revogado_em)',
            [k.token_hash, t.id, k.revogado_em],
          );
        }
      }
      console.log(
        `${s.nome}: ${disp.length} categoria(s) de vaga, ${regras.length} tarifa(s), ${tickets.length} ticket(s) espelhados.`,
      );
    }
  } finally {
    await local.end();
  }
}

if (process.argv.includes('--repetir')) {
  console.log(`Espelhando ${LOCAL.database} → ${env.DB_NAME} a cada 15 s (Ctrl+C para parar).`);
  for (;;) {
    await espelhar().catch((e: Error) => console.error('Falhou:', e.message));
    await new Promise((r) => setTimeout(r, 15_000));
  }
} else {
  await espelhar();
  await fecharPool();
}
