import { calcularEstadia } from '@estacionamento/calculo';
import {
  formatarCentavos,
  type Alerta,
  type DashboardResposta,
  type FaturamentoDia,
  type PontoOcupacao,
  type SituacaoSync,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { obterSiteAtual } from '../../config/site.js';
import type { Autenticacao } from '../auth/auth.service.js';
import { carregarConfig } from '../configuracoes/preferencias.js';
import { dashboardRepository as repo } from './dashboard.repository.js';

/** Limites dos alertas operacionais. */
export const LIMITES = {
  lotacaoAtencao: 0.8,
  lotacaoCritica: 0.95,
  syncAtrasoMin: 15,
  caixaAbertoHoras: 12,
} as const;

const HORA = 60 * 60 * 1000;

/** Ocupação a cada hora cheia das últimas 24h + o instante atual (25 pontos). */
export function calcularOcupacao24h(
  sessoes: { entrada: Date; saida: Date | null }[],
  agora: Date,
): PontoOcupacao[] {
  const horaCheia = new Date(Math.floor(agora.getTime() / HORA) * HORA);
  const instantes = Array.from({ length: 24 }, (_, i) => new Date(horaCheia.getTime() - (23 - i) * HORA));
  instantes.push(agora);
  return instantes.map((t) => ({
    em: t.toISOString(),
    ocupadas: sessoes.filter((s) => s.entrada <= t && (s.saida === null || s.saida > t)).length,
  }));
}

/** Preenche os dias sem pagamento com zero (o gráfico mostra todos os dias). */
export function montarFaturamentoDias(
  linhas: { dia: string; forma: string; total: number }[],
  hoje: string,
  dias: number,
): FaturamentoDia[] {
  const base = new Date(`${hoje}T12:00:00Z`);
  return Array.from({ length: dias }, (_, i) => {
    const d = new Date(base.getTime() - (dias - 1 - i) * 24 * HORA).toISOString().slice(0, 10);
    const doDia = linhas.filter((l) => l.dia === d);
    return {
      data: d,
      totalCentavos: doDia.reduce((s, l) => s + l.total, 0),
      porForma: Object.fromEntries(doDia.map((l) => [l.forma, l.total])),
    };
  });
}

function situacaoSync(s: Awaited<ReturnType<typeof repo.sincronizacao>>): SituacaoSync {
  if (!env.CLOUD_API_URL || !env.SITE_ID) return 'NAO_CONFIGURADA';
  if (s.rejeitados > 0) return 'COM_ERROS';
  if (!s.ultimoSucessoEm) return 'NUNCA_SINCRONIZOU';
  if (s.minutosAtraso !== null && s.minutosAtraso > LIMITES.syncAtrasoMin) return 'ATRASADA';
  return 'EM_DIA';
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export const dashboardService = {
  async obter(auth: Autenticacao): Promise<DashboardResposta> {
    const site = await obterSiteAtual();
    const verOperacao =
      auth.temPermissao('sessao.consultar') ||
      auth.temPermissao('vaga.gerenciar') ||
      auth.temPermissao('relatorio.operacional');
    const verFinanceiro =
      auth.temPermissao('relatorio.financeiro') || auth.temPermissao('caixa.supervisionar');
    const verSync = auth.temPermissao('sync.ver');
    const alertas: Alerta[] = [];
    const agora = await repo.agora();

    let operacao: DashboardResposta['operacao'] = null;
    if (verOperacao) {
      const [porCategoria, veiculos, janela, hoje, ultimos, porHora] = await Promise.all([
        repo.ocupacaoPorCategoria(site.id),
        repo.veiculosEstacionados(site.id),
        repo.sessoesNaJanela(site.id, new Date(agora.getTime() - 24 * HORA)),
        repo.movimentoHoje(site.id),
        repo.ultimosMovimentos(site.id, 10),
        repo.movimentoPorHora(site.id),
      ]);
      const vagas = porCategoria.reduce(
        (t, c) => ({
          total: t.total + c.total,
          disponiveis: t.disponiveis + c.disponiveis,
          ocupadas: t.ocupadas + c.ocupadas,
          bloqueadas: t.bloqueadas + c.bloqueadas,
        }),
        { total: 0, disponiveis: 0, ocupadas: 0, bloqueadas: 0 },
      );
      operacao = {
        vagas,
        porCategoria,
        veiculosEstacionados: veiculos,
        ocupacao24h: calcularOcupacao24h(janela, agora),
        hoje,
        movimentoPorHora: porHora,
        ultimosMovimentos: ultimos,
      };

      for (const c of porCategoria) {
        const uteis = c.total - c.bloqueadas;
        if (uteis <= 0) continue;
        const taxa = c.ocupadas / uteis;
        if (c.disponiveis === 0) {
          alertas.push({
            codigo: `lotado.${c.codigo}`,
            nivel: 'critico',
            titulo: `${c.nome}: lotado`,
            detalhe: `Todas as ${uteis} vagas disponíveis estão ocupadas.`,
          });
        } else if (taxa >= LIMITES.lotacaoCritica) {
          alertas.push({
            codigo: `lotacao.${c.codigo}`,
            nivel: 'serio',
            titulo: `${c.nome}: quase lotado`,
            detalhe: `${Math.round(taxa * 100)}% ocupado — ${plural(c.disponiveis, 'vaga livre', 'vagas livres')}.`,
          });
        } else if (taxa >= LIMITES.lotacaoAtencao) {
          alertas.push({
            codigo: `lotacao.${c.codigo}`,
            nivel: 'atencao',
            titulo: `${c.nome}: ocupação alta`,
            detalhe: `${Math.round(taxa * 100)}% ocupado — ${plural(c.disponiveis, 'vaga livre', 'vagas livres')}.`,
          });
        }
      }
      if (vagas.bloqueadas > 0) {
        alertas.push({
          codigo: 'vagas.bloqueadas',
          nivel: 'info',
          titulo: plural(vagas.bloqueadas, 'vaga em manutenção', 'vagas em manutenção'),
          detalhe: 'Não estão disponíveis para novos veículos.',
        });
      }
      if (veiculos > vagas.ocupadas) {
        const sem = veiculos - vagas.ocupadas;
        alertas.push({
          codigo: 'sessoes.sem_vaga',
          nivel: 'info',
          titulo: plural(sem, 'veículo sem vaga definida', 'veículos sem vaga definida'),
          detalhe: 'Estão estacionados, mas não associados a uma vaga.',
        });
      }
    }

    const config = await carregarConfig();
    const contagens = await repo.contagensParaAlertas(site.id, config.operacao.alertaPermanenciaHoras);
    if (contagens.vagas === 0) {
      alertas.push({
        codigo: 'config.sem_vagas',
        nivel: 'critico',
        titulo: 'Nenhuma vaga cadastrada',
        detalhe: 'Cadastre as vagas para começar a registrar entradas.',
      });
    }
    if (contagens.tarifasVigentes === 0) {
      alertas.push({
        codigo: 'config.sem_tarifa',
        nivel: 'critico',
        titulo: 'Nenhuma tabela de tarifas publicada',
        detalhe: 'Sem tarifa vigente não é possível registrar entradas.',
      });
    }
    const h = config.operacao.alertaPermanenciaHoras;
    if (verOperacao && contagens.sessoesLongas > 0) {
      alertas.push({
        codigo: 'sessoes.longas',
        nivel: 'atencao',
        titulo: plural(contagens.sessoesLongas, `veículo há mais de ${h}h`, `veículos há mais de ${h}h`),
        detalhe: 'Confira se a saída não deixou de ser registrada.',
      });
    }
    if (auth.temPermissao('auditoria.ver') && contagens.loginsFalhos >= 5) {
      alertas.push({
        codigo: 'seguranca.logins',
        nivel: contagens.loginsFalhos >= 20 ? 'serio' : 'atencao',
        titulo: plural(
          contagens.loginsFalhos,
          'tentativa de login errada em 24h',
          'tentativas de login erradas em 24h',
        ),
        detalhe: 'Veja em Auditoria → Atividades (filtro "Login e acesso").',
      });
    }
    if (auth.temPermissao('auditoria.ver') && contagens.acessosNegados > 0) {
      alertas.push({
        codigo: 'seguranca.negados',
        nivel: 'info',
        titulo: plural(contagens.acessosNegados, 'acesso negado em 24h', 'acessos negados em 24h'),
        detalhe: 'Alguém tentou usar uma função sem permissão. Veja em Auditoria.',
      });
    }
    if (auth.temPermissao('sistema.monitorar') && contagens.erros24h > 0) {
      alertas.push({
        codigo: 'falhas.erros',
        nivel: contagens.erros24h >= 10 ? 'serio' : 'atencao',
        titulo: plural(contagens.erros24h, 'erro do sistema em 24h', 'erros do sistema em 24h'),
        detalhe: 'Detalhes em Sistema → Monitoramento.',
      });
    }
    if (auth.temPermissao('backup.gerenciar') && config.backup.ativo) {
      const ultimo = contagens.ultimoBackup?.getTime() ?? 0;
      const falha = contagens.ultimaFalhaBackup?.getTime() ?? 0;
      if (falha > ultimo) {
        alertas.push({
          codigo: 'backup.falhou',
          nivel: 'serio',
          titulo: 'O último backup falhou',
          detalhe: 'Veja o erro em Sistema → Backups e faça um backup manual.',
        });
      } else if (agora.getTime() - ultimo > 26 * HORA) {
        alertas.push({
          codigo: 'backup.atrasado',
          nivel: 'atencao',
          titulo: ultimo ? 'Backup com mais de 1 dia' : 'Nenhum backup feito ainda',
          detalhe: 'Faça um backup manual em Sistema → Backups.',
        });
      }
    }
    if (auth.temPermissao('usuario.gerenciar') && contagens.contasBloqueadas > 0) {
      alertas.push({
        codigo: 'usuarios.bloqueados',
        nivel: 'atencao',
        titulo: plural(contagens.contasBloqueadas, 'conta bloqueada', 'contas bloqueadas'),
        detalhe: 'Excesso de tentativas de login. Veja em Funcionários.',
      });
    }

    let financeiro: DashboardResposta['financeiro'] = null;
    if (verFinanceiro) {
      const [hoje, linhas, estornos, abertas, formas, caixas, caixaHoje] = await Promise.all([
        repo.hojeLocal(),
        repo.faturamentoPorDia(site.id, 7),
        repo.estornosHoje(site.id),
        repo.sessoesAbertasParaCalculo(site.id),
        repo.formasPagamento(),
        repo.caixasAbertos(site.id),
        repo.caixaHoje(site.id),
      ]);
      const dias = montarFaturamentoDias(linhas, hoje, 7);
      const hojeLinhas = linhas.filter((l) => l.dia === hoje);

      let valorEstimado = 0;
      let quantidade = 0;
      let parciais = 0;
      for (const s of abertas) {
        const saldo = calcularEstadia({
          entradaEm: s.entradaEm,
          fim: agora,
          regra: s.regra,
          modalidade: s.modalidade,
          pagoCentavos: s.pagoCentavos,
        }).aPagarCentavos;
        if (saldo > 0) {
          quantidade++;
          valorEstimado += saldo;
          if (s.pagoCentavos > 0) parciais++;
        }
      }

      financeiro = {
        faturamentoHojeCentavos: dias.at(-1)?.totalCentavos ?? 0,
        faturamentoOntemCentavos: dias.at(-2)?.totalCentavos ?? 0,
        hojePorForma: [...formas.entries()].map(([forma, nome]) => {
          const l = hojeLinhas.find((x) => x.forma === forma);
          return { forma, nome, centavos: l?.total ?? 0, quantidade: l?.qtd ?? 0 };
        }),
        estornosHoje: estornos,
        pendentes: { quantidade, valorEstimadoCentavos: valorEstimado, parcialmentePagas: parciais },
        faturamento7dias: dias,
        caixasAbertos: caixas.map(({ minutos: _m, ...c }) => c),
        caixa: caixaHoje,
      };

      for (const c of caixas.filter((x) => x.minutos >= LIMITES.caixaAbertoHoras * 60)) {
        alertas.push({
          codigo: `caixa.longo.${c.id}`,
          nivel: 'atencao',
          titulo: `Caixa aberto há mais de ${LIMITES.caixaAbertoHoras}h`,
          detalhe: `${c.operador} — ${c.posto}. Confira se o fechamento foi esquecido.`,
        });
      }
      if (estornos.quantidade > 0) {
        alertas.push({
          codigo: 'pagamentos.estornos',
          nivel: 'info',
          titulo: plural(estornos.quantidade, 'estorno hoje', 'estornos hoje'),
          detalhe: `Total estornado: ${formatarCentavos(estornos.centavos)}.`,
        });
      }
    }

    let sincronizacao: DashboardResposta['sincronizacao'] = null;
    if (verSync) {
      const s = await repo.sincronizacao(site.id);
      const situacao = situacaoSync(s);
      sincronizacao = {
        situacao,
        pendentes: s.pendentes,
        rejeitados: s.rejeitados,
        ultimoSucessoEm: s.ultimoSucessoEm?.toISOString() ?? null,
        pendenteMaisAntigoEm: s.pendenteMaisAntigo?.toISOString() ?? null,
        ultimoErro: s.ultimoErro,
      };
      if (situacao === 'COM_ERROS') {
        alertas.push({
          codigo: 'sync.erros',
          nivel: 'serio',
          titulo: 'Sincronização com erros',
          detalhe: `${plural(s.rejeitados, 'evento recusado', 'eventos recusados')} pela nuvem.`,
        });
      } else if (situacao === 'ATRASADA') {
        alertas.push({
          codigo: 'sync.atrasada',
          nivel: 'atencao',
          titulo: 'Sincronização atrasada',
          detalhe: `Há dados aguardando envio há ${s.minutosAtraso} min. Verifique a internet.`,
        });
      }
    }

    const ordem = { critico: 0, serio: 1, atencao: 2, info: 3 } as const;
    // Configurações → Notificações: categorias desligadas não aparecem (críticos sempre aparecem)
    const n = config.notificacoes;
    const categoria = (c: string) =>
      c.startsWith('sync.')
        ? n.sincronizacao
        : c.startsWith('backup.')
          ? n.backup
          : c.startsWith('seguranca.') || c === 'usuarios.bloqueados'
            ? n.seguranca
            : c.startsWith('falhas.')
              ? n.falhas
              : n.operacao;
    const visiveis = alertas.filter((a) => a.nivel === 'critico' || categoria(a.codigo));
    visiveis.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
    return { geradoEm: agora.toISOString(), operacao, financeiro, sincronizacao, alertas: visiveis };
  },
};
