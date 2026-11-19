import { useCallback, useEffect, useState } from 'react';
import { formatarPlaca, type Categoria, type Vaga, type VagaDetalhe } from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import {
  DialogoCapacidade,
  DialogoCategorias,
  DialogoMotivo,
  DialogoVaga,
  mensagemDeErro,
} from '../components/vagas/Dialogos';
import { ESTADOS, MapaVagas, duracaoCurta } from '../components/vagas/MapaVagas';
import { useAtualizacaoAutomatica } from '../hooks/useAtualizacaoAutomatica';
import { formatarDataHora } from '../services/rotulos';
import { vagasApi } from '../services/vagas';

type Dialogo = 'nova' | 'editar' | 'bloquear' | 'remover' | 'capacidade' | 'categorias' | null;

export function Vagas() {
  const { temPermissao } = useAuth();
  const podeGerenciar = temPermissao('vaga.gerenciar');
  const podeCapacidade = temPermissao('vaga.capacidade');

  const [categoriaId, setCategoriaId] = useState('');
  const [estado, setEstado] = useState('');
  const [busca, setBusca] = useState('');
  const [incluirRemovidas, setIncluirRemovidas] = useState(false);
  const carregar = useCallback(
    () => vagasApi.listar({ categoriaId, estado, busca: busca.trim(), incluirRemovidas }),
    [categoriaId, estado, busca, incluirRemovidas],
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
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const selecionada = lista.dados?.itens.find((v) => v.id === selecionadaId) ?? null;
  const setorPorCategoria = Object.fromEntries(
    (categorias ?? []).map((c) => {
      const contagem = new Map<string, number>();
      for (const v of lista.dados?.itens ?? []) {
        if (v.categoriaId === c.id && v.setor) contagem.set(v.setor, (contagem.get(v.setor) ?? 0) + 1);
      }
      return [c.id, [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''];
    }),
  );
  const ocupadasPorCategoria = Object.fromEntries(
    (categorias ?? []).map((c) => [
      c.id,
      (lista.dados?.itens ?? []).filter((v) => v.categoriaId === c.id && v.estado === 'OCUPADA').length,
    ]),
  );

  const concluir = (texto: string) => {
    setDialogo(null);
    setMensagem({ tipo: 'ok', texto });
    lista.atualizarAgora();
    setVersaoCategorias((v) => v + 1);
  };
  const executar = async (acao: () => Promise<string>) => {
    try {
      concluir(await acao());
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: mensagemDeErro(e) });
    }
  };

  const criarPadrao = () =>
    void executar(async () => {
      await vagasApi.criarCategoria('CARRO', 'Carro');
      await vagasApi.criarCategoria('MOTO', 'Moto');
      return 'Categorias Carro e Moto criadas. Agora cadastre as vagas.';
    });

  const r = lista.dados?.resumo;
  const semCategorias = categorias !== null && categorias.length === 0;

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Vagas</h1>
          <p className="mudo">
            Mapa em tempo real: muda sozinho a cada entrada e saída (atualiza a cada 10 s).
          </p>
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
              Configurar capacidade
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
      {lista.erro && lista.dados && (
        <p className="alerta alerta--erro">Não foi possível atualizar: {lista.erro.message}</p>
      )}

      {semCategorias && (
        <section className="cartao">
          <h2>Comece pelas categorias de veículo</h2>
          <p className="mudo">
            Cada vaga pertence a uma categoria (carro, moto...), que também define a tarifa.
          </p>
          {podeGerenciar ? (
            <div className="acoes">
              <button type="button" className="botao" onClick={criarPadrao}>
                Criar Carro e Moto
              </button>
              <button
                type="button"
                className="botao botao--secundario"
                onClick={() => setDialogo('categorias')}
              >
                Criar outra categoria
              </button>
            </div>
          ) : (
            <p className="mudo">Peça a um administrador para cadastrar as categorias e as vagas.</p>
          )}
        </section>
      )}

      {r && (
        <section className="resumo-vagas" aria-label="Resumo">
          <Chip
            classe="livre"
            rotulo="Disponíveis"
            valor={r.livres}
            ativo={estado === 'LIVRE'}
            onClick={() => setEstado(estado === 'LIVRE' ? '' : 'LIVRE')}
          />
          <Chip
            classe="ocupada"
            rotulo="Ocupadas"
            valor={r.ocupadas}
            ativo={estado === 'OCUPADA'}
            onClick={() => setEstado(estado === 'OCUPADA' ? '' : 'OCUPADA')}
          />
          <Chip
            classe="bloqueada"
            rotulo="Bloqueadas"
            valor={r.bloqueadas}
            ativo={estado === 'BLOQUEADA'}
            onClick={() => setEstado(estado === 'BLOQUEADA' ? '' : 'BLOQUEADA')}
          />
          <div className="chip chip--total">
            <strong>{r.total}</strong> vagas no total
            {r.removidas > 0 && <span className="mudo"> · {r.removidas} removida(s)</span>}
          </div>
        </section>
      )}

      <div className="filtros cartao">
        <label className="campo campo--crescer">
          <span>Buscar</span>
          <input
            type="search"
            placeholder="Código da vaga ou placa"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            maxLength={20}
          />
        </label>
        <label className="campo">
          <span>Categoria</span>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Todas</option>
            {(categorias ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Situação</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todas</option>
            <option value="LIVRE">Disponível</option>
            <option value="OCUPADA">Ocupada</option>
            <option value="BLOQUEADA">Bloqueada</option>
            <option value="REMOVIDA">Removida</option>
          </select>
        </label>
        <label className="opcao opcao--compacta">
          <input
            type="checkbox"
            checked={incluirRemovidas}
            onChange={(e) => setIncluirRemovidas(e.target.checked)}
          />
          Mostrar removidas
        </label>
      </div>

      <div className={`grade-vagas${selecionada ? ' grade-vagas--com-painel' : ''}`}>
        <section className="cartao cartao--largo">
          {!lista.dados && <p className="mudo">Carregando…</p>}
          {lista.dados && lista.dados.itens.length === 0 && (
            <p className="mudo">
              {r && r.total === 0 ? 'Nenhuma vaga cadastrada ainda.' : 'Nenhuma vaga com esses filtros.'}
            </p>
          )}
          {lista.dados && lista.dados.itens.length > 0 && (
            <>
              <Legenda />
              <MapaVagas
                vagas={lista.dados.itens}
                selecionada={selecionadaId}
                onSelecionar={(id) => setSelecionadaId(id === selecionadaId ? null : id)}
              />
            </>
          )}
        </section>

        {selecionada && (
          <PainelVaga
            key={selecionada.id}
            vaga={selecionada}
            podeGerenciar={podeGerenciar}
            onFechar={() => setSelecionadaId(null)}
            onEditar={() => setDialogo('editar')}
            onBloquear={() => setDialogo('bloquear')}
            onLiberar={() =>
              void executar(
                async () => (await vagasApi.liberar(selecionada.id), `Vaga ${selecionada.codigo} liberada.`),
              )
            }
            onRemover={() => setDialogo('remover')}
            onReativar={() =>
              void executar(
                async () => (
                  await vagasApi.reativar(selecionada.id),
                  `Vaga ${selecionada.codigo} reativada.`
                ),
              )
            }
          />
        )}
      </div>

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
      {selecionada && dialogo === 'bloquear' && (
        <DialogoMotivo
          aberto
          titulo={`Bloquear a vaga ${selecionada.codigo}?`}
          texto="A vaga deixa de receber veículos até ser liberada. Ela continua contando na capacidade."
          textoConfirmar="Bloquear"
          sugestoes={['Manutenção', 'Pintura da demarcação', 'Reservada', 'Obra', 'Piso danificado']}
          onFechar={() => setDialogo(null)}
          acao={async (motivo) => (
            await vagasApi.bloquear(selecionada.id, motivo),
            `Vaga ${selecionada.codigo} bloqueada.`
          )}
          onConcluir={concluir}
        />
      )}
      {selecionada && dialogo === 'remover' && (
        <DialogoMotivo
          aberto
          perigo
          titulo={`Excluir a vaga ${selecionada.codigo}?`}
          texto={
            selecionada.temHistorico
              ? 'Esta vaga já recebeu veículos. Para preservar o histórico, ela será desativada: sai do mapa e da capacidade, mas os registros antigos continuam. Você pode reativá-la depois.'
              : 'Esta vaga nunca foi usada e será excluída definitivamente.'
          }
          textoConfirmar={selecionada.temHistorico ? 'Desativar vaga' : 'Excluir vaga'}
          onFechar={() => setDialogo(null)}
          acao={async (motivo) => {
            const r = await vagasApi.remover(selecionada.id, motivo);
            setSelecionadaId(null);
            return r.resultado === 'EXCLUIDA'
              ? `Vaga ${r.codigo} excluída.`
              : `Vaga ${r.codigo} desativada (histórico preservado).`;
          }}
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
    </>
  );
}

function Chip({
  classe,
  rotulo,
  valor,
  ativo,
  onClick,
}: {
  classe: string;
  rotulo: string;
  valor: number;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chip chip--${classe}${ativo ? ' chip--ativo' : ''}`}
      onClick={onClick}
      aria-pressed={ativo}
      title={`Mostrar só: ${rotulo.toLowerCase()}`}
    >
      <span className="chip__marca" aria-hidden="true" />
      <strong>{valor}</strong> {rotulo}
    </button>
  );
}

function Legenda() {
  return (
    <ul className="legenda-vagas" aria-label="Legenda">
      {(['LIVRE', 'OCUPADA', 'BLOQUEADA'] as const).map((e) => (
        <li key={e}>
          <span className={`legenda-vagas__cor vaga--${e.toLowerCase()}`} aria-hidden="true">
            {ESTADOS[e].icone}
          </span>
          {ESTADOS[e].rotulo}
        </li>
      ))}
    </ul>
  );
}

interface PainelProps {
  vaga: Vaga;
  podeGerenciar: boolean;
  onFechar: () => void;
  onEditar: () => void;
  onBloquear: () => void;
  onLiberar: () => void;
  onRemover: () => void;
  onReativar: () => void;
}

function PainelVaga({
  vaga,
  podeGerenciar,
  onFechar,
  onEditar,
  onBloquear,
  onLiberar,
  onRemover,
  onReativar,
}: PainelProps) {
  const [detalhe, setDetalhe] = useState<VagaDetalhe | null>(null);
  useEffect(() => {
    let ativo = true;
    vagasApi
      .obter(vaga.id)
      .then((d) => ativo && setDetalhe(d))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [vaga.id, vaga.estado]);
  const e = ESTADOS[vaga.estado];

  return (
    <aside className="cartao painel-vaga" aria-label={`Detalhes da vaga ${vaga.codigo}`}>
      <div className="painel-vaga__topo">
        <h2>Vaga {vaga.codigo}</h2>
        <button type="button" className="botao-texto" onClick={onFechar} aria-label="Fechar detalhes">
          Fechar
        </button>
      </div>
      <p className={`estado-vaga estado-vaga--${vaga.estado.toLowerCase()}`}>
        <span aria-hidden="true">{e.icone}</span> {e.rotulo}
      </p>
      <dl className="resumo resumo--linhas">
        <div>
          <dt>Categoria</dt>
          <dd>{vaga.categoria}</dd>
        </div>
        <div>
          <dt>Setor</dt>
          <dd>{vaga.setor ?? '—'}</dd>
        </div>
        <div>
          <dt>Coberta</dt>
          <dd>{vaga.coberta ? 'Sim' : 'Não'}</dd>
        </div>
        {vaga.observacao && (
          <div>
            <dt>Observação</dt>
            <dd>{vaga.observacao}</dd>
          </div>
        )}
      </dl>

      {vaga.ocupacao && (
        <div className="destaque-ocupacao">
          <strong>{formatarPlaca(vaga.ocupacao.placa)}</strong>
          <span className="mudo">
            Ticket nº {vaga.ocupacao.numero} · entrou {formatarDataHora(vaga.ocupacao.entradaEm)} · há{' '}
            {duracaoCurta(vaga.ocupacao.permanenciaMin)}
          </span>
        </div>
      )}
      {vaga.bloqueio && (
        <div className="destaque-bloqueio">
          <strong>{vaga.bloqueio.motivo}</strong>
          <span className="mudo">
            Bloqueada {formatarDataHora(vaga.bloqueio.em)}
            {vaga.bloqueio.por && ` por ${vaga.bloqueio.por}`}
          </span>
        </div>
      )}

      {podeGerenciar && (
        <div className="acoes acoes--quebrar">
          {vaga.estado !== 'REMOVIDA' && (
            <button type="button" className="botao botao--secundario" onClick={onEditar}>
              Editar
            </button>
          )}
          {vaga.estado === 'LIVRE' && (
            <button type="button" className="botao botao--secundario" onClick={onBloquear}>
              Bloquear
            </button>
          )}
          {vaga.estado === 'BLOQUEADA' && (
            <button type="button" className="botao" onClick={onLiberar}>
              Liberar
            </button>
          )}
          {(vaga.estado === 'LIVRE' || vaga.estado === 'BLOQUEADA') && (
            <button type="button" className="botao botao--perigo" onClick={onRemover}>
              Excluir
            </button>
          )}
          {vaga.estado === 'REMOVIDA' && (
            <button type="button" className="botao" onClick={onReativar}>
              Reativar
            </button>
          )}
        </div>
      )}
      {vaga.estado === 'OCUPADA' && podeGerenciar && (
        <p className="mudo pequeno">
          Vaga ocupada: registre a saída do veículo para poder bloquear ou excluir.
        </p>
      )}

      <h3>Últimos usos</h3>
      {!detalhe && <p className="mudo">Carregando…</p>}
      {detalhe && detalhe.ultimosUsos.length === 0 && (
        <p className="mudo">Esta vaga ainda não recebeu veículos.</p>
      )}
      {detalhe && detalhe.ultimosUsos.length > 0 && (
        <ul className="lista-simples">
          {detalhe.ultimosUsos.map((u) => (
            <li key={u.sessaoId}>
              <code>{formatarPlaca(u.placa)}</code>{' '}
              <span className="mudo">· {formatarDataHora(u.entradaEm)}</span>
              {u.status === 'CANCELADA' && <span className="mudo"> · cancelado</span>}
              {u.status === 'ABERTA' && <span className="mudo"> · ainda estacionado</span>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
