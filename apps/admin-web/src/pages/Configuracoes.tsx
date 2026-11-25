import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  HORAS_APOS_SAIDA_MAX,
  LOGO_MAX_BYTES,
  formatarCentavos,
  permissaoCabeNoNivel,
  type CatalogoPermissoes,
  type ConfiguracaoSeguranca,
  type ConfiguracoesGerais,
  type DadosEstacionamento,
  type LimitesAjuste,
  type PreferenciasNotificacao,
  type PreferenciasOperacao,
  type SessaoLoginAtiva,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Dialogo } from '../components/Dialogo';
import { SeletorPermissoes } from '../components/SeletorPermissoes';
import { StatusSincronizacao } from '../components/StatusSincronizacao';
import { recarregarConfigPainel } from '../hooks/useConfigPainel';
import { ErroDaApi } from '../services/api';
import { configGeralApi, configuracoesApi, type CategoriaEditavel } from '../services/configuracoes';
import { formatarDataHora } from '../services/rotulos';
import { usuariosApi } from '../services/usuarios';
import { vagasApi } from '../services/vagas';

type Aba =
  'estacionamento' | 'operacao' | 'tarifas' | 'usuarios' | 'seguranca' | 'integracoes' | 'notificacoes';

const mensagemDeErro = (e: unknown) =>
  e instanceof ErroDaApi && Array.isArray(e.corpo.detalhes) && e.corpo.detalhes.length
    ? (e.corpo.detalhes as { mensagem: string }[]).map((d) => d.mensagem).join('. ')
    : e instanceof Error
      ? e.message
      : 'Não foi possível salvar.';

/** Configurações gerais, organizadas por categoria (uma aba cada). */
export function Configuracoes() {
  const { temPermissao } = useAuth();
  const [params, setParams] = useSearchParams();
  const [dados, setDados] = useState<ConfiguracoesGerais | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const geral = temPermissao('config.gerenciar');
  const seguranca = temPermissao('config.seguranca');
  const abas = (
    [
      geral && ['estacionamento', 'Estacionamento'],
      geral && ['operacao', 'Operação'],
      (temPermissao('tarifa.ver') || temPermissao('tarifa.gerenciar')) && ['tarifas', 'Tarifas'],
      (seguranca || temPermissao('perfil.gerenciar')) && ['usuarios', 'Usuários e permissões'],
      seguranca && ['seguranca', 'Segurança e acessos'],
      geral && ['integracoes', 'Comunicação e integrações'],
      geral && ['notificacoes', 'Notificações'],
    ] as (false | [Aba, string])[]
  ).filter((x): x is [Aba, string] => !!x);
  const pedida = params.get('aba') as Aba | null;
  const aba = abas.find(([id]) => id === pedida)?.[0] ?? abas[0]?.[0] ?? 'estacionamento';

  useEffect(() => {
    configGeralApi.obter().then(setDados, (e: unknown) => setErro(mensagemDeErro(e)));
  }, []);

  /** Salva uma categoria e mostra quem alterou. */
  async function salvar(categoria: CategoriaEditavel, valor: unknown, texto: string) {
    const novo = await configGeralApi.salvar(categoria, valor);
    setDados(novo);
    setAviso(texto);
    recarregarConfigPainel();
  }

  const alteracao = (chave: string) => {
    const a = dados?.alteracoes[chave];
    return a ? (
      <p className="rodape-alteracao">
        Última alteração: {formatarDataHora(a.em)}
        {a.por && ` por ${a.por}`}
      </p>
    ) : null;
  };

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Configurações</h1>
          <p className="mudo">Dados do estacionamento, operação, acessos, integrações e alertas.</p>
        </div>
      </header>
      <div className="abas abas--pagina abas--secoes" role="tablist">
        {abas.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? 'aba aba--ativa' : 'aba'}
            onClick={() => {
              setAviso(null);
              setParams({ aba: id }, { replace: true });
            }}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="alerta alerta--ok" role="status">
          {aviso}
        </p>
      )}
      {!dados && !erro && <p className="mudo">Carregando…</p>}
      {dados && (
        <>
          {aba === 'estacionamento' && (
            <AbaEstacionamento
              valor={dados.estacionamento}
              rodape={alteracao('estacionamento')}
              onSalvar={(v) => salvar('estacionamento', v, 'Dados do estacionamento salvos.')}
            />
          )}
          {aba === 'operacao' && (
            <AbaOperacao
              valor={dados.operacao}
              rodape={alteracao('operacao')}
              onSalvar={(v) => salvar('operacao', v, 'Preferências de operação salvas.')}
            />
          )}
          {aba === 'tarifas' && <AbaTarifas />}
          {aba === 'usuarios' && (
            <AbaUsuarios
              limites={dados.limitesAjuste}
              rodape={alteracao('limitesAjuste')}
              onSalvarLimites={(v) =>
                salvar('limitesAjuste', v, 'Limites de desconto salvos. Valem na hora.')
              }
            />
          )}
          {aba === 'seguranca' && dados.seguranca && (
            <AbaSeguranca
              valor={dados.seguranca}
              rodape={alteracao('seguranca')}
              onSalvar={(v) => salvar('seguranca', v, 'Regras de segurança salvas. Valem a partir de agora.')}
            />
          )}
          {aba === 'integracoes' && <AbaIntegracoes dados={dados} onAviso={setAviso} />}
          {aba === 'notificacoes' && (
            <AbaNotificacoes
              valor={dados.notificacoes}
              rodape={alteracao('notificacoes')}
              onSalvar={(v) => salvar('notificacoes', v, 'Preferências de alertas salvas.')}
            />
          )}
        </>
      )}
    </>
  );
}

/** Formulário com botão Salvar, erro e "salvando". */
function Formulario({
  titulo,
  descricao,
  children,
  onSalvar,
  alterado,
  rodape,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
  onSalvar: () => Promise<void>;
  alterado: boolean;
  rodape?: ReactNode;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await onSalvar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <section className="cartao">
      <h2>{titulo}</h2>
      {descricao && <p className="mudo">{descricao}</p>}
      <form onSubmit={enviar} noValidate>
        {children}
        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        )}
        <div className="acoes">
          <button type="submit" className="botao" disabled={enviando || !alterado}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        {rodape}
      </form>
    </section>
  );
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Opcao({
  marcado,
  onChange,
  titulo,
  ajuda,
}: {
  marcado: boolean;
  onChange: (v: boolean) => void;
  titulo: string;
  ajuda: string;
}) {
  return (
    <label className="opcao-check">
      <input type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{titulo}</strong>
        <small>{ajuda}</small>
      </span>
    </label>
  );
}

// ------------------------------------------------------------ Estacionamento
function AbaEstacionamento({
  valor,
  rodape,
  onSalvar,
}: {
  valor: DadosEstacionamento;
  rodape: ReactNode;
  onSalvar: (v: DadosEstacionamento) => Promise<void>;
}) {
  const [v, setV] = useState(valor);
  const [erroLogo, setErroLogo] = useState<string | null>(null);
  const campo = (k: keyof DadosEstacionamento) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });

  function escolherLogo(arquivo: File | undefined) {
    setErroLogo(null);
    if (!arquivo) return;
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) {
      setErroLogo('Use uma imagem PNG, JPEG ou WebP.');
      return;
    }
    if (arquivo.size > LOGO_MAX_BYTES) {
      setErroLogo(
        `A imagem tem ${Math.ceil(arquivo.size / 1024)} KB. O máximo é ${LOGO_MAX_BYTES / 1024} KB.`,
      );
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setV((atual) => ({ ...atual, logo: String(leitor.result) }));
    leitor.readAsDataURL(arquivo);
  }

  return (
    <Formulario
      titulo="Dados do estacionamento"
      descricao="Aparecem no topo do painel e identificam o estacionamento."
      alterado={!igual(v, valor)}
      rodape={rodape}
      onSalvar={() => onSalvar({ ...v, endereco: v.endereco || null, telefone: v.telefone || null })}
    >
      <div className="grade-config">
        <label className="campo">
          <span>Nome</span>
          <input value={v.nome} onChange={campo('nome')} maxLength={120} required />
        </label>
        <label className="campo">
          <span>Telefone</span>
          <input
            value={v.telefone ?? ''}
            onChange={campo('telefone')}
            inputMode="tel"
            placeholder="(11) 99999-0000"
            maxLength={20}
          />
        </label>
        <label className="campo">
          <span>Endereço</span>
          <input value={v.endereco ?? ''} onChange={campo('endereco')} maxLength={255} />
        </label>
        <label className="campo">
          <span>Horário de funcionamento</span>
          <input
            value={v.horarioFuncionamento ?? ''}
            onChange={campo('horarioFuncionamento')}
            placeholder="Seg a sex 7h–22h; sáb 8h–14h"
            maxLength={200}
          />
        </label>
      </div>
      <div className="campo">
        <span>Logotipo</span>
        <div className="logo-previa">
          {v.logo ? <img src={v.logo} alt="Logotipo atual" /> : <span className="mudo">Sem logotipo</span>}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Escolher logotipo"
            onChange={(e) => escolherLogo(e.target.files?.[0])}
          />
          {v.logo && (
            <button
              type="button"
              className="botao botao--secundario botao--pequeno"
              onClick={() => setV({ ...v, logo: null })}
            >
              Remover
            </button>
          )}
        </div>
        <small>PNG, JPEG ou WebP de até {LOGO_MAX_BYTES / 1024} KB.</small>
        {erroLogo && (
          <p className="alerta alerta--erro" role="alert">
            {erroLogo}
          </p>
        )}
      </div>
    </Formulario>
  );
}

// ------------------------------------------------------------ Operação
function AbaOperacao({
  valor,
  rodape,
  onSalvar,
}: {
  valor: PreferenciasOperacao;
  rodape: ReactNode;
  onSalvar: (v: PreferenciasOperacao) => Promise<void>;
}) {
  const [v, setV] = useState(valor);
  const [vagas, setVagas] = useState<{ total: number; categorias: string[]; bloqueadas: number } | null>(
    null,
  );
  useEffect(() => {
    Promise.all([vagasApi.listar({ incluirRemovidas: false }), vagasApi.categorias()])
      .then(([l, c]) =>
        setVagas({
          total: l.itens.length,
          bloqueadas: l.itens.filter((x) => x.estado === 'BLOQUEADA').length,
          categorias: c.itens.filter((x) => x.ativo).map((x) => x.nome),
        }),
      )
      .catch(() => undefined);
  }, []);
  return (
    <>
      <section className="cartao">
        <h2>Vagas e tipos de veículo</h2>
        {vagas ? (
          <p>
            <strong>{vagas.total}</strong> vagas cadastradas ({vagas.bloqueadas} bloqueadas). Tipos de veículo
            aceitos: <strong>{vagas.categorias.join(', ') || 'nenhum'}</strong>.
          </p>
        ) : (
          <p className="mudo">Carregando…</p>
        )}
        <p className="mudo">
          A quantidade de vagas, a identificação (códigos e setores) e os tipos aceitos são definidos na tela
          de Vagas. Bloquear uma vaga sempre pede o motivo, e uma vaga ocupada não pode ser bloqueada.
        </p>
        <div className="acoes">
          <Link to="/" className="botao botao--secundario">
            Abrir Vagas
          </Link>
        </div>
      </section>
      <Formulario
        titulo="Entrada e saída"
        alterado={!igual(v, valor)}
        rodape={rodape}
        onSalvar={() => onSalvar(v)}
      >
        <div className="grade-config">
          <Opcao
            marcado={v.vagaAutomatica}
            onChange={(x) => setV({ ...v, vagaAutomatica: x })}
            titulo="Vaga automática na entrada"
            ajuda="Já vem escolhida a primeira vaga livre do tipo do veículo. O operador pode trocar."
          />
          <Opcao
            marcado={v.mostrarQrNaEntrada}
            onChange={(x) => setV({ ...v, mostrarQrNaEntrada: x })}
            titulo="Mostrar o QR Code depois da entrada"
            ajuda="Abre o QR Code do cliente assim que a entrada é registrada."
          />
          <Opcao
            marcado={v.confirmarSaida}
            onChange={(x) => setV({ ...v, confirmarSaida: x })}
            titulo="Confirmar antes de encerrar a saída"
            ajuda="Pede uma confirmação com o valor e as formas de pagamento antes de liberar a vaga."
          />
        </div>
        <label className="campo">
          <span>Avisar no Painel quando um veículo passar de (horas estacionado)</span>
          <input
            type="number"
            min={0}
            max={720}
            value={v.alertaPermanenciaHoras}
            onChange={(e) => setV({ ...v, alertaPermanenciaHoras: Math.max(0, Number(e.target.value) || 0) })}
          />
          <small>0 = não avisar.</small>
        </label>
      </Formulario>
    </>
  );
}

// ------------------------------------------------------------ Tarifas
function AbaTarifas() {
  return (
    <section className="cartao">
      <h2>Tarifas</h2>
      <p>
        Valores de carro e moto, períodos especiais (ex.: noturno), regras de cobrança e o histórico de
        alterações ficam na tela de Tarifas.
      </p>
      <p className="mudo">
        Uma alteração de preço nunca muda o valor de quem já está estacionado: cada ticket guarda a tarifa da
        hora em que entrou.
      </p>
      <div className="acoes">
        <Link to="/tarifas" className="botao">
          Abrir Tarifas
        </Link>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ Usuários e permissões
function AbaUsuarios({
  limites,
  rodape,
  onSalvarLimites,
}: {
  limites?: LimitesAjuste;
  rodape: ReactNode;
  onSalvarLimites: (v: LimitesAjuste) => Promise<void>;
}) {
  const { temPermissao } = useAuth();
  const [catalogo, setCatalogo] = useState<CatalogoPermissoes | null>(null);
  const [nivel, setNivel] = useState<'padrao_gerente' | 'padrao_operador'>('padrao_operador');
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [l, setL] = useState(limites);
  const podePadroes = temPermissao('perfil.gerenciar');

  useEffect(() => {
    if (!podePadroes) return;
    usuariosApi.catalogo().then(setCatalogo, (e: unknown) => setErro(mensagemDeErro(e)));
  }, [podePadroes]);
  const modelo = catalogo?.modelos.find((m) => m.codigo === nivel);
  const [modeloAnterior, setModeloAnterior] = useState<typeof modelo>(undefined);
  if (modelo !== modeloAnterior) {
    setModeloAnterior(modelo);
    setMarcadas(modelo?.permissoes ?? []);
  }
  const codigoNivel = nivel === 'padrao_gerente' ? 'gerente' : 'funcionario';

  async function salvarPadrao() {
    setEnviando(true);
    setErro(null);
    setOk(null);
    try {
      await configGeralApi.salvarPadrao(nivel, marcadas);
      setCatalogo(await usuariosApi.catalogo());
      setOk('Permissões padrão salvas. Valem para os próximos cadastros.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const campoLimite = (n: keyof LimitesAjuste, k: 'percentualMax' | 'valorMaxCentavos', rotulo: string) =>
    l && (
      <label className="campo">
        <span>{rotulo}</span>
        <input
          type="number"
          min={0}
          max={k === 'percentualMax' ? 100 : 100000}
          step={k === 'percentualMax' ? 1 : 0.01}
          value={k === 'percentualMax' ? l[n][k] : l[n][k] / 100}
          onChange={(e) => {
            const x = Math.max(0, Number(e.target.value) || 0);
            setL({
              ...l,
              [n]: { ...l[n], [k]: k === 'percentualMax' ? Math.round(x) : Math.round(x * 100) },
            });
          }}
        />
      </label>
    );

  return (
    <>
      <section className="cartao">
        <h2>Níveis de acesso</h2>
        <ul className="lista-simples">
          <li>
            <strong>Administrador</strong> — acesso completo: funcionários, tarifas, backups, segurança e
            LGPD.
          </li>
          <li>
            <strong>Gerente</strong> — caixas, relatórios e ajustes dentro do limite abaixo. Não cria
            administradores nem gerentes, não mexe em segurança nem em backups.
          </li>
          <li>
            <strong>Operador</strong> — entradas, saídas, consulta de veículos e recebimento. Não altera
            tarifas nem vê relatórios financeiros gerais.
          </li>
        </ul>
        <div className="acoes">
          <Link to="/usuarios" className="botao botao--secundario">
            Gerenciar funcionários
          </Link>
        </div>
      </section>

      {l && (
        <Formulario
          titulo="Limite de desconto"
          descricao="O máximo que cada nível concede sozinho na saída. Acima disso, só um administrador. Vale o menor dos dois limites."
          alterado={!igual(l, limites)}
          rodape={rodape}
          onSalvar={() => onSalvarLimites(l)}
        >
          <div className="grade-config">
            {campoLimite('gerente', 'percentualMax', 'Gerente: até (% do valor)')}
            {campoLimite('gerente', 'valorMaxCentavos', 'Gerente: até (R$, 0 = só o %)')}
            {campoLimite('funcionario', 'percentualMax', 'Operador: até (% do valor)')}
            {campoLimite('funcionario', 'valorMaxCentavos', 'Operador: até (R$, 0 = só o %)')}
          </div>
          <p className="mudo pequeno">
            Hoje: gerente até {l.gerente.percentualMax}%
            {l.gerente.valorMaxCentavos > 0 && ` e ${formatarCentavos(l.gerente.valorMaxCentavos)}`}; operador
            até {l.funcionario.percentualMax}%
            {l.funcionario.valorMaxCentavos > 0 && ` e ${formatarCentavos(l.funcionario.valorMaxCentavos)}`}.
            O operador também precisa da permissão “Conceder desconto ou acréscimo”.
          </p>
        </Formulario>
      )}

      {podePadroes && (
        <section className="cartao">
          <h2>Permissões padrão por nível</h2>
          <p className="mudo">
            Vêm marcadas ao cadastrar um funcionário do nível. Quem já tem acesso mantém as permissões dele.
          </p>
          <label className="campo">
            <span>Nível</span>
            <select value={nivel} onChange={(e) => setNivel(e.target.value as typeof nivel)}>
              <option value="padrao_operador">Operador</option>
              <option value="padrao_gerente">Gerente</option>
            </select>
          </label>
          {erro && (
            <p className="alerta alerta--erro" role="alert">
              {erro}
            </p>
          )}
          {ok && (
            <p className="alerta alerta--ok" role="status">
              {ok}
            </p>
          )}
          {catalogo ? (
            <SeletorPermissoes
              catalogo={catalogo}
              valor={marcadas}
              onChange={setMarcadas}
              podeConceder={(c) => permissaoCabeNoNivel(codigoNivel, c)}
            />
          ) : (
            <p className="mudo">Carregando…</p>
          )}
          <div className="acoes">
            <button
              type="button"
              className="botao"
              disabled={
                enviando || !catalogo || igual([...marcadas].sort(), [...(modelo?.permissoes ?? [])].sort())
              }
              onClick={() => void salvarPadrao()}
            >
              {enviando ? 'Salvando…' : 'Salvar permissões padrão'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------ Segurança
function AbaSeguranca({
  valor,
  rodape,
  onSalvar,
}: {
  valor: ConfiguracaoSeguranca;
  rodape: ReactNode;
  onSalvar: (v: ConfiguracaoSeguranca) => Promise<void>;
}) {
  const { temPermissao } = useAuth();
  const [v, setV] = useState(valor);
  const numero = (
    k: keyof ConfiguracaoSeguranca,
    rotulo: string,
    min: number,
    max: number,
    ajuda?: string,
  ) => (
    <label className="campo">
      <span>{rotulo}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={v[k] as number}
        onChange={(e) => setV({ ...v, [k]: Math.round(Number(e.target.value) || 0) })}
      />
      {ajuda && <small>{ajuda}</small>}
    </label>
  );
  return (
    <>
      <Formulario
        titulo="Sessão, senha e bloqueio"
        descricao="Valem para todos os funcionários a partir de agora. Regras de senha valem nas próximas trocas de senha."
        alterado={!igual(v, valor)}
        rodape={rodape}
        onSalvar={() => onSalvar(v)}
      >
        <div className="grade-config">
          {numero('inatividadeMin', 'Sessão expira sem uso após (min)', 5, 480)}
          {numero(
            'duracaoMaxHoras',
            'Duração máxima da sessão (horas)',
            1,
            72,
            'Um turno; depois pede login de novo.',
          )}
          {numero('maxTentativas', 'Senhas erradas até bloquear', 3, 20)}
          {numero('bloqueioMin', 'Tempo de bloqueio (min)', 1, 1440)}
          {numero('senhaMinimo', 'Tamanho mínimo da senha', 8, 64)}
        </div>
        <div className="grade-config">
          <Opcao
            marcado={v.senhaExigirMaiuscula}
            onChange={(x) => setV({ ...v, senhaExigirMaiuscula: x })}
            titulo="Exigir letra maiúscula"
            ajuda="Além de letras e números (sempre exigidos)."
          />
          <Opcao
            marcado={v.senhaExigirSimbolo}
            onChange={(x) => setV({ ...v, senhaExigirSimbolo: x })}
            titulo="Exigir símbolo"
            ajuda="Ex.: ! @ # $"
          />
          <Opcao
            marcado={v.somenteRedeLocal}
            onChange={(x) => setV({ ...v, somenteRedeLocal: x })}
            titulo="Acesso só pela rede do estacionamento"
            ajuda="Recusa login vindo de fora da rede local (internet)."
          />
        </div>
      </Formulario>
      {temPermissao('usuario.sessoes') && <SessoesAbertas />}
    </>
  );
}

function SessoesAbertas() {
  const [itens, setItens] = useState<SessaoLoginAtiva[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [encerrar, setEncerrar] = useState<SessaoLoginAtiva | null>(null);
  const carregar = () =>
    configGeralApi.sessoes().then(
      (r) => setItens(r.itens),
      (e: unknown) => setErro(mensagemDeErro(e)),
    );
  useEffect(() => {
    void carregar();
  }, []);
  return (
    <section className="cartao">
      <h2>Sessões abertas</h2>
      <p className="mudo">Quem está conectado ao painel agora. Encerrar obriga a pessoa a entrar de novo.</p>
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {!itens && !erro && <p className="mudo">Carregando…</p>}
      {itens && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>Computador (IP)</th>
                <th>Entrou</th>
                <th>Último uso</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {itens.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.nome} <span className="mudo pequeno">({s.usuario})</span>
                  </td>
                  <td>{s.ip ?? '—'}</td>
                  <td className="sem-quebra">{formatarDataHora(s.criadaEm)}</td>
                  <td className="sem-quebra">{formatarDataHora(s.ultimoUsoEm)}</td>
                  <td>
                    {s.atual ? (
                      <span className="mudo pequeno">esta sessão</span>
                    ) : (
                      <button
                        type="button"
                        className="botao botao--perigo botao--pequeno"
                        onClick={() => setEncerrar(s)}
                      >
                        Encerrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialogo
        aberto={!!encerrar}
        titulo="Encerrar sessão"
        textoConfirmar="Encerrar sessão"
        perigo
        onFechar={() => setEncerrar(null)}
        onConfirmar={() =>
          encerrar &&
          void configGeralApi
            .encerrarSessao(encerrar.id)
            .then(() => {
              setEncerrar(null);
              return carregar();
            })
            .catch((e: unknown) => setErro(mensagemDeErro(e)))
        }
      >
        <p>
          Encerrar a sessão de <strong>{encerrar?.nome}</strong> (IP {encerrar?.ip ?? 'desconhecido'})? A
          pessoa precisará entrar de novo.
        </p>
      </Dialogo>
    </section>
  );
}

// ------------------------------------------------------------ Integrações
const OPCOES_HORAS = [0, 1, 2, 6, 12, 24, 48, 72, 168];
const textoHoras = (h: number) =>
  h === 0 ? 'Encerrar na saída' : h === 168 ? '7 dias' : h === 1 ? '1 hora' : `${h} horas`;

function AbaIntegracoes({ dados, onAviso }: { dados: ConfiguracoesGerais; onAviso: (t: string) => void }) {
  const i = dados.integracao;
  const [horas, setHoras] = useState(dados.acessoCliente.horasAposSaida);
  const [salva, setSalva] = useState(dados.acessoCliente.horasAposSaida);
  return (
    <>
      <section className="cartao">
        <h2>Servidor externo</h2>
        <dl className="lista-definicoes">
          <dt>Situação</dt>
          <dd>{i.configurada ? 'Configurado' : 'Não configurado (rode o Conectar-Nuvem.cmd)'}</dd>
          <dt>Endereço da API externa</dt>
          <dd>{i.urlApiExterna ?? '—'}</dd>
          <dt>Endereço do app do cliente</dt>
          <dd>{i.urlAppCliente ?? '—'}</dd>
          <dt>Envio</dt>
          <dd>
            {i.intervaloEnvioSeg
              ? `A cada ${i.intervaloEnvioSeg} segundos; sem internet, os dados ficam guardados e são enviados quando ela voltar.`
              : '—'}
          </dd>
        </dl>
        <p className="mudo pequeno">
          Os endereços e a credencial ficam no arquivo de configuração do servidor (definidos pelo
          Conectar-Nuvem.cmd), não no banco, para que a chave nunca apareça na tela.
        </p>
      </section>
      <Formulario
        titulo="App do cliente (link e QR Code)"
        descricao="Enquanto o veículo está no estacionamento o link sempre funciona. O app atualiza o ticket sozinho a cada 30 segundos."
        alterado={horas !== salva}
        rodape={null}
        onSalvar={async () => {
          const p = await configuracoesApi.salvarAcessoCliente({ horasAposSaida: horas });
          setSalva(p.horasAposSaida);
          onAviso('Política do link salva. Vale para as próximas saídas.');
        }}
      >
        <label className="campo">
          <span>Depois da saída, o link funciona por</span>
          <select value={horas} onChange={(e) => setHoras(Number(e.target.value))}>
            {[...new Set([...OPCOES_HORAS, horas])]
              .filter((h) => h <= HORAS_APOS_SAIDA_MAX)
              .sort((a, b) => a - b)
              .map((h) => (
                <option key={h} value={h}>
                  {textoHoras(h)}
                </option>
              ))}
          </select>
        </label>
      </Formulario>
      <StatusSincronizacao />
    </>
  );
}

// ------------------------------------------------------------ Notificações
function AbaNotificacoes({
  valor,
  rodape,
  onSalvar,
}: {
  valor: PreferenciasNotificacao;
  rodape: ReactNode;
  onSalvar: (v: PreferenciasNotificacao) => Promise<void>;
}) {
  const [v, setV] = useState(valor);
  const op = (k: keyof PreferenciasNotificacao, titulo: string, ajuda: string) => (
    <Opcao marcado={v[k]} onChange={(x) => setV({ ...v, [k]: x })} titulo={titulo} ajuda={ajuda} />
  );
  return (
    <Formulario
      titulo="Alertas no Painel"
      descricao="Escolha o que aparece em “Alertas” no Painel. Alertas críticos (ex.: sem tarifa publicada) sempre aparecem."
      alterado={!igual(v, valor)}
      rodape={rodape}
      onSalvar={() => onSalvar(v)}
    >
      <div className="grade-config">
        {op('falhas', 'Falhas do sistema', 'Erros do servidor nas últimas 24 horas.')}
        {op('backup', 'Backups', 'Backup que falhou ou com mais de 1 dia.')}
        {op('sincronizacao', 'Sincronização', 'Dados que não chegaram ao app do cliente.')}
        {op('seguranca', 'Segurança', 'Senhas erradas, contas bloqueadas e acessos negados.')}
        {op(
          'operacao',
          'Operação',
          'Lotação, vagas bloqueadas, veículos há muito tempo e caixas esquecidos.',
        )}
      </div>
    </Formulario>
  );
}
