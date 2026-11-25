import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { formatarPlaca, type Categoria, type EstadoVaga, type Vaga } from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Dialogo } from '../components/Dialogo';
import {
  IconeAtualizar,
  IconeCadeado,
  IconeCarro,
  IconeFiltro,
  IconeMoto,
  IconeProibido,
} from '../components/Icones';
import {
  DialogoCapacidade,
  DialogoCategorias,
  DialogoVaga,
  mensagemDeErro,
} from '../components/vagas/Dialogos';
import { duracaoCurta } from '../components/vagas/MapaVagas';
import { ModalVaga } from '../components/vagas/ModalVaga';
import { useAtualizacaoAutomatica } from '../hooks/useAtualizacaoAutomatica';
import { vagasApi } from '../services/vagas';

/** Situação mostrada na tela. REMOVIDA = desativada: aparece como "Indisponível". */
const SITUACAO: Record<EstadoVaga, { rotulo: string; classe: string }> = {
  LIVRE: { rotulo: 'Livre', classe: 'livre' },
  OCUPADA: { rotulo: 'Ocupada', classe: 'ocupada' },
  BLOQUEADA: { rotulo: 'Bloqueada', classe: 'bloqueada' },
  REMOVIDA: { rotulo: 'Indisponível', classe: 'indisponivel' },
};

type Dialogos = 'nova' | 'editar' | 'capacidade' | 'categorias' | 'status' | 'saida' | null;

export function Vagas() {
  const { temPermissao } = useAuth();
  const navegar = useNavigate();
  const podeGerenciar = temPermissao('vaga.gerenciar');
  const podeCapacidade = temPermissao('vaga.capacidade');
  const podeSaida = temPermissao('sessao.saida');

  const [setor, setSetor] = useState('');
  const [busca, setBusca] = useState('');
  // Indisponíveis (desativadas) aparecem no mapa, em cinza
  const carregar = useCallback(
    () => vagasApi.listar({ busca: busca.trim(), incluirRemovidas: true }),
    [busca],
  );
  const lista = useAtualizacaoAutomatica(carregar, 10_000);

  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [versaoCategorias, setVersaoCategorias] = useState(0);
  useEffect(() => {
    let ativo = true;
    vagasApi
      .categorias()
      .then((r) => ativo && setCategorias(r.itens))
      .catch(() => ativo && setCategorias([]));
    return () => {
      ativo = false;
    };
  }, [versaoCategorias]);

  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogos>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const todas = lista.dados?.itens ?? [];
  const visiveis = setor ? todas.filter((v) => (v.setor ?? '') === setor) : todas;
  const selecionada = todas.find((v) => v.id === selecionadaId) ?? null;
  const setores = [...new Set(todas.map((v) => v.setor ?? ''))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const codigoCategoria = new Map((categorias ?? []).map((c) => [c.id, c.codigo]));

  const setorPorCategoria = Object.fromEntries(
    (categorias ?? []).map((c) => {
      const contagem = new Map<string, number>();
      for (const v of todas)
        if (v.categoriaId === c.id && v.setor) contagem.set(v.setor, (contagem.get(v.setor) ?? 0) + 1);
      return [c.id, [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''];
    }),
  );
  const ocupadasPorCategoria = Object.fromEntries(
    (categorias ?? []).map((c) => [
      c.id,
      todas.filter((v) => v.categoriaId === c.id && v.estado === 'OCUPADA').length,
    ]),
  );

  const concluir = (texto: string) => {
    setDialogo(null);
    setMensagem({ tipo: 'ok', texto });
    lista.atualizarAgora();
    setVersaoCategorias((v) => v + 1);
  };

  const criarPadrao = async () => {
    try {
      await vagasApi.criarCategoria('CARRO', 'Carro');
      await vagasApi.criarCategoria('MOTO', 'Moto');
      concluir('Categorias Carro e Moto criadas. Agora cadastre as vagas.');
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: mensagemDeErro(e) });
    }
  };

  const r = lista.dados?.resumo;
  const total = r?.total ?? 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const semCategorias = categorias !== null && categorias.length === 0;

  return (
    <div className="pagina-vagas">
      <header className="cabecalho cabecalho--icone">
        <div className="cabecalho__titulo">
          <span className="selo-pagina" aria-hidden="true">
            P
          </span>
          <div>
            <h1>Vagas</h1>
            <p className="mudo">Visualize e gerencie as vagas do estacionamento</p>
          </div>
        </div>
        <div className="acoes acoes--quebrar">
          {podeGerenciar && (
            <button
              type="button"
              className="botao botao--secundario"
              onClick={() => setDialogo('categorias')}
            >
              Categorias
            </button>
          )}
          {podeCapacidade && !semCategorias && (
            <button
              type="button"
              className="botao botao--secundario"
              onClick={() => setDialogo('capacidade')}
            >
              Capacidade
            </button>
          )}
          {podeGerenciar && !semCategorias && (
            <button type="button" className="botao" onClick={() => setDialogo('nova')}>
              Nova vaga
            </button>
          )}
        </div>
      </header>

      {mensagem && (
        <p className={`alerta alerta--${mensagem.tipo}`} role={mensagem.tipo === 'erro' ? 'alert' : 'status'}>
          {mensagem.texto}
        </p>
      )}
      {lista.erro && (
        <p className="alerta alerta--erro" role="alert">
          Não foi possível atualizar: {lista.erro.message}
        </p>
      )}

      {semCategorias && (
        <section className="cartao">
          <h2>Comece pelas categorias de veículo</h2>
          <p className="mudo">
            Cada vaga pertence a uma categoria (carro, moto...), que também define a tarifa.
          </p>
          {podeGerenciar ? (
            <div className="acoes">
              <button type="button" className="botao" onClick={() => void criarPadrao()}>
                Criar Carro e Moto
              </button>
            </div>
          ) : (
            <p className="mudo">Peça a um administrador para cadastrar as categorias e as vagas.</p>
          )}
        </section>
      )}

      <section className="indicadores-vagas" aria-label="Resumo das vagas">
        <Indicador
          classe="total"
          icone={<IconeCarro tamanho={30} />}
          valor={r?.total}
          rotulo="Total de vagas"
        />
        <Indicador
          classe="livre"
          icone={<IconeCarro tamanho={30} />}
          valor={r?.livres}
          rotulo="Livres"
          pct={pct(r?.livres ?? 0)}
        />
        <Indicador
          classe="ocupada"
          icone={<IconeCarro tamanho={30} />}
          valor={r?.ocupadas}
          rotulo="Ocupadas"
          pct={pct(r?.ocupadas ?? 0)}
        />
        <Indicador
          classe="bloqueada"
          icone={<IconeCadeado tamanho={28} />}
          valor={r?.bloqueadas}
          rotulo="Bloqueadas"
          pct={pct(r?.bloqueadas ?? 0)}
        />
      </section>

      <div className="vagas-corpo vagas-corpo--modal">
        <section className="cartao vagas-mapa">
          <div className="vagas-mapa__barra">
            <label className="filtro-setor">
              <IconeFiltro tamanho={18} />
              <span>Filtrar por setor:</span>
              <select value={setor} onChange={(e) => setSetor(e.target.value)}>
                <option value="">Todos os setores</option>
                {setores.map((s) => (
                  <option key={s || '_'} value={s}>
                    {s || 'Sem setor'}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="vagas-mapa__busca"
              type="search"
              placeholder="Buscar vaga ou placa"
              aria-label="Buscar vaga ou placa"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              maxLength={20}
            />
            <button
              type="button"
              className="botao botao--secundario botao--pequeno"
              onClick={() => {
                setMensagem(null);
                lista.atualizarAgora();
              }}
              disabled={lista.atualizando}
            >
              <IconeAtualizar tamanho={16} /> {lista.atualizando ? 'Atualizando…' : 'Atualizar'}
            </button>
            <ul className="legenda" aria-label="Legenda">
              {(['LIVRE', 'OCUPADA', 'BLOQUEADA', 'REMOVIDA'] as const).map((e) => (
                <li key={e}>
                  <span
                    className={`legenda__ponto legenda__ponto--${SITUACAO[e].classe}`}
                    aria-hidden="true"
                  />
                  {SITUACAO[e].rotulo}
                </li>
              ))}
            </ul>
          </div>

          {!lista.dados && <p className="mudo">Carregando…</p>}
          {lista.dados && visiveis.length === 0 && (
            <p className="mudo">
              {total === 0 && !busca ? 'Nenhuma vaga cadastrada ainda.' : 'Nenhuma vaga com esses filtros.'}
            </p>
          )}
          <div className="vagas-grade">
            {visiveis.map((v) => {
              const s = SITUACAO[v.estado];
              const moto = codigoCategoria.get(v.categoriaId) === 'MOTO';
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`vaga-bloco vaga-bloco--${s.classe}${selecionadaId === v.id ? ' vaga-bloco--selecionada' : ''}`}
                  onClick={() => setSelecionadaId(v.id)}
                  aria-pressed={selecionadaId === v.id}
                  aria-label={`Vaga ${v.codigo}, ${v.categoria}: ${s.rotulo}${v.ocupacao ? `, placa ${formatarPlaca(v.ocupacao.placa)}` : ''}`}
                  title={
                    v.bloqueio ? `Bloqueada: ${v.bloqueio.motivo}` : v.setor ? `Setor ${v.setor}` : undefined
                  }
                >
                  <span className="vaga-bloco__codigo">{v.codigo}</span>
                  <span className="vaga-bloco__icone">
                    {v.estado === 'BLOQUEADA' ? (
                      <IconeCadeado tamanho={26} />
                    ) : v.estado === 'REMOVIDA' ? (
                      <IconeProibido tamanho={26} />
                    ) : moto ? (
                      <IconeMoto tamanho={28} />
                    ) : (
                      <IconeCarro tamanho={28} />
                    )}
                  </span>
                  <span className="vaga-bloco__pilula">{s.rotulo}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <ModalVaga
        vaga={selecionada}
        podeGerenciar={podeGerenciar}
        podeSaida={podeSaida}
        onFechar={() => setSelecionadaId(null)}
        onSaida={() => setDialogo('saida')}
        onStatus={() => setDialogo('status')}
        onEditar={() => setDialogo('editar')}
      />

      {selecionada?.ocupacao && dialogo === 'saida' && (
        <Dialogo
          aberto
          titulo={`Dar saída na vaga ${selecionada.codigo}?`}
          textoConfirmar="Ir para a saída"
          onFechar={() => setDialogo(null)}
          onConfirmar={() => void navegar(`/operacao?saida=${selecionada.ocupacao!.sessaoId}`)}
        >
          <p>
            Veículo <strong>{formatarPlaca(selecionada.ocupacao.placa)}</strong>, ticket nº{' '}
            {selecionada.ocupacao.numero}, estacionado há {duracaoCurta(selecionada.ocupacao.permanenciaMin)}.
          </p>
          <p className="mudo">
            Você vai para a tela de saída com o ticket já aberto, para conferir o valor e registrar o
            pagamento. A saída só é gravada quando você confirmar lá.
          </p>
        </Dialogo>
      )}
      {selecionada && dialogo === 'status' && (
        <DialogoStatus vaga={selecionada} onFechar={() => setDialogo(null)} onConcluir={concluir} />
      )}
      {categorias && dialogo === 'nova' && (
        <DialogoVaga
          aberto
          vaga={null}
          categorias={categorias}
          setores={lista.dados?.setores ?? []}
          onFechar={() => setDialogo(null)}
          onConcluir={concluir}
        />
      )}
      {categorias && selecionada && dialogo === 'editar' && (
        <DialogoVaga
          aberto
          vaga={selecionada}
          categorias={categorias}
          setores={lista.dados?.setores ?? []}
          onFechar={() => setDialogo(null)}
          onConcluir={concluir}
        />
      )}
      {categorias && dialogo === 'capacidade' && (
        <DialogoCapacidade
          aberto
          categorias={categorias}
          ocupadasPorCategoria={ocupadasPorCategoria}
          setorPorCategoria={setorPorCategoria}
          onFechar={() => setDialogo(null)}
          onConcluir={concluir}
        />
      )}
      {categorias && dialogo === 'categorias' && (
        <DialogoCategorias
          aberto
          categorias={categorias}
          onFechar={() => setDialogo(null)}
          onAlterou={() => setVersaoCategorias((v) => v + 1)}
        />
      )}
    </div>
  );
}

function Indicador({
  classe,
  icone,
  valor,
  rotulo,
  pct,
}: {
  classe: string;
  icone: ReactNode;
  valor: number | undefined;
  rotulo: string;
  pct?: number;
}) {
  return (
    <div className={`indicador indicador--${classe}`}>
      <span className="indicador__icone">{icone}</span>
      <div className="indicador__texto">
        <strong>{valor ?? '…'}</strong>
        <span>{rotulo}</span>
        {pct !== undefined && (
          <span className="indicador__barra" role="img" aria-label={`${pct}% do total`}>
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}

type NovoStatus = 'LIVRE' | 'BLOQUEADA' | 'REMOVIDA';

/** Alterar a situação da vaga, sempre com confirmação. */
function DialogoStatus({
  vaga,
  onFechar,
  onConcluir,
}: {
  vaga: Vaga;
  onFechar: () => void;
  onConcluir: (msg: string) => void;
}) {
  const opcoes: NovoStatus[] =
    vaga.estado === 'LIVRE'
      ? ['BLOQUEADA', 'REMOVIDA']
      : vaga.estado === 'BLOQUEADA'
        ? ['LIVRE', 'REMOVIDA']
        : vaga.estado === 'REMOVIDA'
          ? ['LIVRE']
          : [];
  const [novo, setNovo] = useState<NovoStatus | null>(opcoes[0] ?? null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const precisaMotivo = novo === 'BLOQUEADA' || novo === 'REMOVIDA';

  async function confirmar() {
    if (!novo) return onFechar();
    if (precisaMotivo && motivo.trim().length < 3) return setErro('Informe o motivo (pelo menos 3 letras).');
    setEnviando(true);
    setErro(null);
    try {
      if (novo === 'BLOQUEADA') await vagasApi.bloquear(vaga.id, motivo.trim());
      else if (novo === 'LIVRE' && vaga.estado === 'REMOVIDA') await vagasApi.reativar(vaga.id);
      else if (novo === 'LIVRE') await vagasApi.liberar(vaga.id);
      else {
        const r = await vagasApi.remover(vaga.id, motivo.trim());
        return onConcluir(
          r.resultado === 'EXCLUIDA'
            ? `Vaga ${r.codigo} excluída (nunca tinha sido usada).`
            : `Vaga ${r.codigo} agora está indisponível (histórico preservado).`,
        );
      }
      onConcluir(`Vaga ${vaga.codigo}: ${SITUACAO[novo].rotulo.toLowerCase()}.`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo={`Alterar status da vaga ${vaga.codigo}`}
      textoConfirmar={opcoes.length ? 'Confirmar alteração' : 'Fechar'}
      perigo={novo === 'REMOVIDA'}
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void confirmar()}
    >
      <p>
        Situação atual:{' '}
        <span className={`pilula pilula--${SITUACAO[vaga.estado].classe}`}>
          {SITUACAO[vaga.estado].rotulo}
        </span>
      </p>
      {vaga.estado === 'OCUPADA' ? (
        <p className="mudo">A vaga está ocupada. Dê saída no veículo antes de mudar a situação dela.</p>
      ) : (
        <>
          <fieldset className="opcoes-status">
            <legend>Nova situação</legend>
            {opcoes.map((o) => (
              <label key={o} className={`opcao-status${novo === o ? ' opcao-status--marcada' : ''}`}>
                <input type="radio" name="status" checked={novo === o} onChange={() => setNovo(o)} />
                <span className={`legenda__ponto legenda__ponto--${SITUACAO[o].classe}`} aria-hidden="true" />
                <span>
                  <strong>{SITUACAO[o].rotulo}</strong>
                  <span className="mudo pequeno">
                    {o === 'LIVRE'
                      ? ' — volta a receber veículos'
                      : o === 'BLOQUEADA'
                        ? ' — temporário (manutenção, reserva...): continua na capacidade'
                        : vaga.temHistorico
                          ? ' — desativada: sai da capacidade, o histórico é preservado'
                          : ' — nunca usada: será excluída'}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {precisaMotivo && (
            <label className="campo">
              <span>Motivo</span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={255}
                placeholder={
                  novo === 'BLOQUEADA' ? 'Ex.: Manutenção, Reservada' : 'Ex.: Vaga eliminada na reforma'
                }
                list="sugestoes-motivo"
                autoFocus
              />
              <datalist id="sugestoes-motivo">
                {['Manutenção', 'Pintura da demarcação', 'Reservada', 'Obra', 'Piso danificado'].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}
        </>
      )}
    </Dialogo>
  );
}
