import { promises as dns } from 'node:dns';
import { statfs } from 'node:fs/promises';
import { cpus, freemem, hostname, loadavg, totalmem, uptime as uptimeSistema } from 'node:os';
import type { RowDataPacket } from 'mysql2/promise';
import { appInfo } from '../config/app-info.js';
import { env } from '../config/env.js';
import { obterSiteAtual } from '../config/site.js';
import { pool } from '../db/pool.js';
import { backupService, pastaBackups } from '../backup/backup.service.js';
import { statusSync } from '../sync/index.js';

/**
 * Monitoramento técnico (painel → Monitoramento). Cada componente recebe um
 * nível — OK, ATENCAO ou FALHA — e um texto do que fazer; o estado geral é o
 * pior deles. As verificações de rede ficam em cache por 15 s (o painel
 * atualiza sozinho e várias abas abertas não multiplicam as consultas).
 */
export type Nivel = 'OK' | 'ATENCAO' | 'FALHA' | 'DESLIGADO';

export interface Componente {
  nivel: Nivel;
  resumo: string;
  detalhes: Record<string, string | number | boolean | null>;
  acao?: string;
}

export interface PainelMonitoramento {
  geradoEm: string;
  geral: Nivel;
  alertas: { nivel: Nivel; componente: string; mensagem: string; acao?: string }[];
  componentes: {
    servidor: Componente;
    banco: Componente;
    internet: Componente;
    apiExterna: Componente;
    sincronizacao: Componente;
    backup: Componente;
  };
  falhasComunicacao: { em: string; tipo: string; erro: string | null; httpStatus: number | null }[];
  errosRecentes: {
    em: string;
    origem: string;
    codigo: string | null;
    mensagem: string;
    rota: string | null;
  }[];
  contagens: { errosUltimas24h: number; falhasSyncUltimas24h: number };
}

const CACHE_MS = 15_000;
let cacheRede: { em: number; internet: Componente; api: Componente } | null = null;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const pior = (a: Nivel, b: Nivel): Nivel => {
  const ordem: Nivel[] = ['DESLIGADO', 'OK', 'ATENCAO', 'FALHA'];
  return ordem.indexOf(a) >= ordem.indexOf(b) ? a : b;
};
const comTempo = async <T>(fn: () => Promise<T>, limiteMs: number): Promise<{ valor: T; ms: number }> => {
  const t = Date.now();
  const valor = await Promise.race([
    fn(),
    new Promise<never>((_, falha) =>
      setTimeout(() => falha(new Error(`sem resposta em ${limiteMs / 1000} s`)), limiteMs),
    ),
  ]);
  return { valor, ms: Date.now() - t };
};
const mb = (b: number) => Math.round(b / 1_048_576);

async function verificarServidor(): Promise<Componente> {
  const mem = process.memoryUsage();
  const livreGb = await statfs(pastaBackups())
    .catch(() => statfs('.'))
    .then((s) => (s.bavail * s.bsize) / 1024 ** 3)
    .catch(() => null);
  const carga = loadavg()[0] ?? 0;
  const nucleos = cpus().length || 1;
  const memLivrePct = (freemem() / totalmem()) * 100;
  let nivel: Nivel = 'OK';
  let acao: string | undefined;
  if (livreGb !== null && livreGb < 2) {
    nivel = 'FALHA';
    acao = 'Pouco espaço em disco: libere espaço ou mova a pasta de backups (BACKUP_DIR).';
  } else if ((livreGb !== null && livreGb < 10) || memLivrePct < 5) {
    nivel = 'ATENCAO';
    acao =
      livreGb !== null && livreGb < 10
        ? 'Espaço em disco acabando.'
        : 'Memória do computador quase toda em uso.';
  }
  return {
    nivel,
    resumo: `No ar há ${duracao(process.uptime())} · versão ${appInfo.versao}`,
    detalhes: {
      computador: hostname(),
      versao: appInfo.versao,
      ambiente: env.NODE_ENV,
      https: env.HTTPS,
      noArDesde: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      memoriaProcessoMb: mb(mem.rss),
      memoriaLivrePct: Math.round(memLivrePct),
      cargaCpu: Math.round((carga / nucleos) * 100) / 100,
      discoLivreGb: livreGb === null ? null : Math.round(livreGb * 10) / 10,
      computadorLigadoHa: duracao(uptimeSistema()),
      node: process.version,
    },
    acao,
  };
}

async function verificarBanco(): Promise<Componente> {
  try {
    const { ms } = await comTempo(() => pool.query('SELECT 1'), 3000);
    const [[info]] = await pool.query<RowDataPacket[]>(
      `SELECT VERSION() AS versao,
              (SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE()) AS bytes`,
    );
    const [[con]] = await pool.query<RowDataPacket[]>("SHOW STATUS LIKE 'Threads_connected'");
    const nivel: Nivel = ms > 500 ? 'ATENCAO' : 'OK';
    return {
      nivel,
      resumo: `Respondendo em ${ms} ms`,
      detalhes: {
        banco: env.DB_NAME,
        versao: String(info?.versao ?? ''),
        latenciaMs: ms,
        tamanhoMb: mb(Number(info?.bytes ?? 0)),
        conexoes: Number(con?.Value ?? 0),
      },
      acao: nivel === 'ATENCAO' ? 'Banco lento: verifique o uso do disco e do processador.' : undefined,
    };
  } catch (e) {
    return {
      nivel: 'FALHA',
      resumo: 'Banco de dados INDISPONÍVEL',
      detalhes: { banco: env.DB_NAME, erro: (e as Error).message.slice(0, 200) },
      acao: 'Verifique se o serviço do MySQL está ligado (services.msc → MySQL84) e reinicie-o.',
    };
  }
}

async function verificarRede(): Promise<{ internet: Componente; api: Componente }> {
  if (cacheRede && Date.now() - cacheRede.em < CACHE_MS) return cacheRede;
  const url = env.CLOUD_API_URL ? new URL(env.CLOUD_API_URL) : null;
  // API na própria máquina/rede (demonstração): não depende da internet
  const apiLocal = !!url && /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(url.hostname);
  // Internet: resolver um nome público (o da nuvem, se houver)
  let internet: Componente;
  const alvo = url && !apiLocal ? url.hostname : 'dns.google';
  try {
    const { ms } = await comTempo(() => dns.resolve4(alvo), 4000);
    internet = {
      nivel: 'OK',
      resumo: `Conectado (DNS em ${ms} ms)`,
      detalhes: { verificado: alvo, latenciaMs: ms },
    };
  } catch (e) {
    internet = {
      // Sem nuvem (ou com nuvem local) a internet não afeta nada: só atenção
      nivel: url && !apiLocal ? 'FALHA' : 'ATENCAO',
      resumo: 'Sem internet',
      detalhes: { verificado: alvo, erro: (e as Error).message.slice(0, 120) },
      acao: 'Verifique o cabo/Wi-Fi e o roteador. O estacionamento continua funcionando; os dados para a nuvem ficam na fila.',
    };
  }
  // API externa: /saude
  let api: Componente;
  if (!url) {
    api = {
      nivel: 'DESLIGADO',
      resumo: 'Não configurada',
      detalhes: {},
      acao: 'Configure CLOUD_API_URL, SYNC_INTEGRACAO_ID e SYNC_SECRET para o app do cliente receber os dados.',
    };
  } else {
    try {
      const { valor: r, ms } = await comTempo(
        () => fetch(new URL('/saude', url), { signal: AbortSignal.timeout(5000) }),
        5500,
      );
      const corpo = (await r.json().catch(() => null)) as { status?: string } | null;
      api =
        r.ok && corpo?.status === 'ok'
          ? {
              nivel: ms > 2000 ? 'ATENCAO' : 'OK',
              resumo: `No ar (${ms} ms)`,
              detalhes: { endereco: url.host, latenciaMs: ms },
            }
          : {
              nivel: 'FALHA',
              resumo: `Respondeu com problema (HTTP ${r.status})`,
              detalhes: { endereco: url.host, httpStatus: r.status, status: corpo?.status ?? null },
              acao: 'A API externa está com problema (provavelmente o banco da nuvem). Veja o painel do provedor.',
            };
    } catch (e) {
      api = {
        nivel: 'FALHA',
        resumo: 'Inacessível',
        detalhes: { endereco: url.host, erro: (e as Error).message.slice(0, 120) },
        acao: apiLocal
          ? `A API externa não responde em ${url.host}: verifique se ela está ligada.`
          : internet.nivel !== 'OK'
            ? 'Sem internet neste computador: a API externa não pode ser alcançada.'
            : 'A internet funciona, mas a API externa não responde: verifique o provedor (Render, Railway...).',
      };
    }
  }
  cacheRede = { em: Date.now(), internet, api };
  return cacheRede;
}

async function verificarSync(): Promise<Componente> {
  const s = await statusSync();
  if (!s.configurado)
    return {
      nivel: 'DESLIGADO',
      resumo: 'Desligada',
      detalhes: { pendentes: s.pendentes },
      acao: 'Sincronização com a nuvem não configurada.',
    };
  const atrasoMin = s.pendenteMaisAntigoEm ? (Date.now() - Date.parse(s.pendenteMaisAntigoEm)) / 60_000 : 0;
  const semContatoMin = s.ultimoContatoEm ? (Date.now() - Date.parse(s.ultimoContatoEm)) / 60_000 : Infinity;
  let nivel: Nivel = 'OK';
  let acao: string | undefined;
  if (s.rejeitados.length) {
    nivel = 'FALHA';
    acao = `${s.rejeitados.length} alteração(ões) recusada(s) pela nuvem: use "Ressincronizar" em Configurações.`;
  } else if (s.falhasSeguidas > 0 && (semContatoMin > 10 || atrasoMin > 10)) {
    nivel = 'FALHA';
    acao = `Envio falhando há ${Math.round(Math.max(semContatoMin === Infinity ? 0 : semContatoMin, atrasoMin))} min: ${s.ultimoErro ?? ''}`;
  } else if (s.falhasSeguidas > 0 || atrasoMin > 2) {
    nivel = 'ATENCAO';
    acao = s.ultimoErro ?? 'Envio atrasado.';
  }
  return {
    nivel,
    resumo:
      s.pendentes + s.marcasPendentes > 0
        ? `${s.pendentes + s.marcasPendentes} registro(s) pendente(s)`
        : s.rejeitados.length
          ? 'Alterações recusadas pela nuvem'
          : s.falhasSeguidas > 0
            ? 'Sem contato com a nuvem (nada pendente)'
            : 'Em dia',
    detalhes: {
      pendentes: s.pendentes,
      deteccoesPendentes: s.marcasPendentes,
      pendenteMaisAntigoEm: s.pendenteMaisAntigoEm,
      recusados: s.rejeitados.length,
      ultimaSincronizacaoEm: s.ultimoSucessoEm,
      ultimoContatoEm: s.ultimoContatoEm,
      ultimaConferenciaEm: s.ultimaConferenciaEm,
      falhasSeguidas: s.falhasSeguidas,
      ultimoErro: s.ultimoErro,
    },
    acao,
  };
}

async function verificarBackup(): Promise<Componente> {
  const s = await backupService.situacao();
  if (!s.ativo)
    return {
      nivel: 'ATENCAO',
      resumo: 'Backup automático desligado',
      detalhes: {},
      acao: 'Ligue BACKUP_ATIVO no .env.',
    };
  const horas = s.ultimoSucesso
    ? (Date.now() - Date.parse(s.ultimoSucesso.iniciadoEm)) / 3_600_000
    : Infinity;
  const falhaRecente =
    s.ultimaFalha && (!s.ultimoSucesso || s.ultimaFalha.iniciadoEm > s.ultimoSucesso.iniciadoEm);
  let nivel: Nivel = 'OK';
  let acao: string | undefined;
  if (horas > 48 || falhaRecente || s.comProblema) {
    nivel = 'FALHA';
    acao = falhaRecente
      ? `Último backup falhou: ${s.ultimaFalha!.erro ?? ''}`
      : s.comProblema
        ? `${s.comProblema} backup(s) com problema na conferência.`
        : 'Nenhum backup nas últimas 48 horas.';
  } else if (horas > 26 || !s.copia) {
    nivel = 'ATENCAO';
    acao =
      horas > 26 ? 'Backup atrasado (mais de 26 h).' : 'Sem segunda cópia dos backups (BACKUP_COPIA_DIR).';
  }
  return {
    nivel,
    resumo: s.ultimoSucesso
      ? `Último: ${new Date(s.ultimoSucesso.iniciadoEm).toLocaleString('pt-BR')}`
      : 'Nenhum backup ainda',
    detalhes: {
      ultimoSucessoEm: s.ultimoSucesso?.iniciadoEm ?? null,
      ultimaFalhaEm: s.ultimaFalha?.iniciadoEm ?? null,
      proximoEm: s.proximoEm,
      guardados: s.guardados,
      segundaCopia: s.copia !== null,
    },
    acao,
  };
}

function duracao(seg: number): string {
  const m = Math.floor(seg / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

const NOMES: Record<keyof PainelMonitoramento['componentes'], string> = {
  servidor: 'Servidor local',
  banco: 'Banco de dados',
  internet: 'Internet',
  apiExterna: 'API externa',
  sincronizacao: 'Sincronização',
  backup: 'Backup',
};

export const monitoramentoService = {
  async painel(): Promise<PainelMonitoramento> {
    const [servidor, banco, rede] = await Promise.all([
      verificarServidor(),
      verificarBanco(),
      verificarRede(),
    ]);
    const bancoOk = banco.nivel !== 'FALHA';
    const indisponivel = (n: string): Componente => ({
      nivel: 'FALHA',
      resumo: 'Sem dados (banco indisponível)',
      detalhes: {},
      acao: `Resolva o banco de dados para ver ${n}.`,
    });
    const [sincronizacao, backup] = bancoOk
      ? await Promise.all([
          verificarSync().catch(() => indisponivel('a sincronização')),
          verificarBackup().catch(() => indisponivel('os backups')),
        ])
      : [indisponivel('a sincronização'), indisponivel('os backups')];
    const componentes = {
      servidor,
      banco,
      internet: rede.internet,
      apiExterna: rede.api,
      sincronizacao,
      backup,
    };

    let falhasComunicacao: PainelMonitoramento['falhasComunicacao'] = [];
    let errosRecentes: PainelMonitoramento['errosRecentes'] = [];
    const contagens = { errosUltimas24h: 0, falhasSyncUltimas24h: 0 };
    if (bancoOk) {
      const site = await obterSiteAtual();
      const [f] = await pool.query<RowDataPacket[]>(
        `SELECT iniciado_em, tipo, erro, http_status FROM sync_execucoes
          WHERE site_id = ? AND NOT sucesso ORDER BY id DESC LIMIT 15`,
        [site.id],
      );
      falhasComunicacao = f.map((x) => ({
        em: iso(x.iniciado_em)!,
        tipo: String(x.tipo),
        erro: (x.erro as string | null) ?? null,
        httpStatus: x.http_status === null ? null : Number(x.http_status),
      }));
      const [e] = await pool.query<RowDataPacket[]>(
        'SELECT ocorrido_em, origem, codigo, mensagem, metodo, rota FROM erros_sistema ORDER BY id DESC LIMIT 15',
      );
      errosRecentes = e.map((x) => ({
        em: iso(x.ocorrido_em)!,
        origem: String(x.origem),
        codigo: (x.codigo as string | null) ?? null,
        mensagem: String(x.mensagem),
        rota: x.rota ? `${String(x.metodo ?? '')} ${String(x.rota)}`.trim() : null,
      }));
      const [[c]] = await pool.query<RowDataPacket[]>(
        `SELECT (SELECT COUNT(*) FROM erros_sistema WHERE ocorrido_em >= NOW(3) - INTERVAL 1 DAY) AS erros,
                (SELECT COUNT(*) FROM sync_execucoes WHERE site_id = ? AND NOT sucesso AND iniciado_em >= NOW(3) - INTERVAL 1 DAY) AS falhas`,
        [site.id],
      );
      contagens.errosUltimas24h = Number(c?.erros ?? 0);
      contagens.falhasSyncUltimas24h = Number(c?.falhas ?? 0);
      // Retenção: erros com mais de 30 dias saem
      void pool
        .query('DELETE FROM erros_sistema WHERE ocorrido_em < NOW(3) - INTERVAL 30 DAY LIMIT 1000')
        .catch(() => undefined);
    }
    const alertas = (Object.keys(componentes) as (keyof typeof componentes)[])
      .filter((k) => componentes[k].nivel === 'FALHA' || componentes[k].nivel === 'ATENCAO')
      .map((k) => ({
        nivel: componentes[k].nivel,
        componente: NOMES[k],
        mensagem: componentes[k].resumo,
        acao: componentes[k].acao,
      }))
      .sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'FALHA' ? -1 : 1));
    if (contagens.errosUltimas24h >= 10)
      alertas.push({
        nivel: 'ATENCAO',
        componente: 'Erros',
        mensagem: `${contagens.errosUltimas24h} erros internos nas últimas 24 h`,
        acao: 'Veja a lista de erros recentes; se repetirem, informe o suporte com o horário.',
      });
    const geral = alertas.reduce<Nivel>((g, a) => pior(g, a.nivel), 'OK');
    return {
      geradoEm: new Date().toISOString(),
      geral,
      alertas,
      componentes,
      falhasComunicacao,
      errosRecentes,
      contagens,
    };
  },

  /** Para os testes: esquece o cache das verificações de rede. */
  limparCache() {
    cacheRede = null;
  },
};
