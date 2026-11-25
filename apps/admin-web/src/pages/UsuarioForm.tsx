import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  formatarCpf,
  NIVEIS_ACESSO,
  POLITICA_SENHA,
  permissaoCabeNoNivel,
  problemasDaSenha,
  type CatalogoPermissoes,
  type DadosFuncionario,
  type FuncionarioDetalhe,
  type NivelAcesso,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Dialogo } from '../components/Dialogo';
import { SeletorPermissoes } from '../components/SeletorPermissoes';
import { useCarregar } from '../hooks/useCarregar';
import { ErroDaApi } from '../services/api';
import { ROTULOS_SITUACAO, formatarDataHora } from '../services/rotulos';
import { usuariosApi } from '../services/usuarios';

/** Rota /usuarios/novo e /usuarios/:id */
export function UsuarioForm() {
  const { id } = useParams();
  const catalogo = useCarregar(useCallback(() => usuariosApi.catalogo(), []));
  const detalhe = useCarregar(useCallback(() => (id ? usuariosApi.obter(id) : Promise.resolve(null)), [id]));
  // A mensagem fica aqui (e não no formulário) para sobreviver à recarga após salvar.
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);

  // "Carregando" só na primeira vez: ao recarregar depois de salvar, os dados
  // antigos continuam na tela até os novos chegarem.
  const semDados = catalogo.dados === null || (id !== undefined && detalhe.dados === null);
  const erro = catalogo.erro ?? detalhe.erro;
  if (erro && semDados) return <p className="alerta alerta--erro">{erro.message}</p>;
  if (semDados) return <p className="mudo">Carregando…</p>;

  return (
    <Formulario
      // Recria o formulário com os dados novos após cada alteração salva
      key={detalhe.dados?.atualizadoEm ?? 'novo'}
      catalogo={catalogo.dados!}
      inicial={detalhe.dados}
      aoSalvar={detalhe.recarregar}
      mensagem={mensagem}
      setMensagem={setMensagem}
    />
  );
}

function mensagemDe(e: unknown): string {
  if (e instanceof ErroDaApi) {
    const d = e.corpo.detalhes;
    const extras = Array.isArray(d) ? d.map((x) => x.mensagem).filter((m) => m !== e.message) : [];
    if (extras.length) return `${e.message}: ${extras.join('; ')}`;
    return e.message;
  }
  return e instanceof Error ? e.message : 'Erro inesperado';
}

/** Sugere uma senha provisória fácil de ditar: Palavra + 4 dígitos. */
function sugerirSenha(): string {
  const palavras = ['Vaga', 'Placa', 'Ticket', 'Rampa', 'Cancela', 'Patio'];
  const n = crypto.getRandomValues(new Uint32Array(2));
  return `${palavras[n[0]! % palavras.length]}${String(1000 + (n[1]! % 9000))}`;
}

type Mensagem = { tipo: 'ok' | 'erro'; texto: string };

interface FormProps {
  catalogo: CatalogoPermissoes;
  inicial: FuncionarioDetalhe | null;
  aoSalvar: () => void;
  mensagem: Mensagem | null;
  setMensagem: (m: Mensagem | null) => void;
}

function Formulario({ catalogo, inicial, aoSalvar, mensagem, setMensagem }: FormProps) {
  const navegar = useNavigate();
  const { usuario, temPermissao, regrasSenha } = useAuth();
  const souAdmin = usuario?.perfis.some((p) => p.codigo === 'admin') ?? false;
  const novo = inicial === null;
  const ehVoceMesmo = inicial?.acesso?.usuarioId === usuario?.id;
  const alvoEhAdmin = inicial?.acesso?.nivel === 'admin';
  // Gerente só cuida de Operadores
  const alvoEhGerente = inicial?.acesso?.nivel === 'gerente';
  const podeEditarDados =
    temPermissao('funcionario.gerenciar', 'usuario.gerenciar') && (souAdmin || !alvoEhAdmin);
  const podeEditarAcesso =
    temPermissao('usuario.gerenciar') && !ehVoceMesmo && (souAdmin || (!alvoEhAdmin && !alvoEhGerente));

  const [dados, setDados] = useState<Required<DadosFuncionario>>({
    nome: inicial?.nome ?? '',
    cpf: inicial?.cpf ? formatarCpf(inicial.cpf) : '',
    telefone: inicial?.telefone ?? '',
    email: inicial?.email ?? '',
    cargo: inicial?.cargo ?? '',
    dataAdmissao: inicial?.dataAdmissao ?? '',
  });
  const [comAcesso, setComAcesso] = useState(Boolean(inicial?.acesso));
  const [login, setLogin] = useState(inicial?.acesso?.login ?? '');
  const [nivel, setNivel] = useState<NivelAcesso>(inicial?.acesso?.nivel ?? 'funcionario');
  const [permissoes, setPermissoes] = useState<string[]>(
    () =>
      inicial?.permissoes ??
      catalogo.modelos
        .find((m) => m.codigo === 'padrao_operador')
        ?.permissoes.filter((c) => permissaoCabeNoNivel('funcionario', c) && (souAdmin || temPermissao(c))) ??
      [],
  );
  const [senha, setSenha] = useState('');

  const [salvando, setSalvando] = useState<'dados' | 'acesso' | null>(null);
  const [dialogo, setDialogo] = useState<'desativar' | 'reativar' | 'senha' | null>(null);

  const precisaSenha = comAcesso && !inicial?.acesso;
  const problemasSenha =
    precisaSenha && senha ? problemasDaSenha(senha, login, regrasSenha ?? undefined) : [];
  const podeConceder = (c: string) => permissaoCabeNoNivel(nivel, c) && (souAdmin || temPermissao(c));
  /** Troca de nível: novo cadastro recebe as permissões padrão; existente perde as que não cabem. */
  function escolherNivel(n: NivelAcesso) {
    setNivel(n);
    if (n === 'admin') return;
    const padrao = catalogo.modelos.find(
      (m) => m.codigo === (n === 'gerente' ? 'padrao_gerente' : 'padrao_operador'),
    );
    const cabe = (c: string) => permissaoCabeNoNivel(n, c) && (souAdmin || temPermissao(c));
    setPermissoes((atuais) =>
      (novo || !inicial?.acesso) && padrao ? padrao.permissoes.filter(cabe) : atuais.filter(cabe),
    );
  }
  const campo = (k: keyof DadosFuncionario) => ({
    value: dados[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDados((d) => ({ ...d, [k]: e.target.value })),
    disabled: !podeEditarDados,
  });
  const acessoParaEnvio = () => ({
    login,
    nivel,
    permissoes,
    ...(precisaSenha ? { senhaProvisoria: senha } : {}),
  });

  async function salvarNovo(e: FormEvent) {
    e.preventDefault();
    setSalvando('dados');
    setMensagem(null);
    try {
      const criado = await usuariosApi.criar({ ...dados, acesso: comAcesso ? acessoParaEnvio() : null });
      navegar(`/usuarios/${criado.id}`, { replace: true, state: { criado: true } });
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemDe(falha) });
    } finally {
      setSalvando(null);
    }
  }

  async function executar(tipo: 'dados' | 'acesso', acao: () => Promise<unknown>, sucesso: string) {
    setSalvando(tipo);
    setMensagem(null);
    try {
      await acao();
      setMensagem({ tipo: 'ok', texto: sucesso });
      aoSalvar();
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemDe(falha) });
    } finally {
      setSalvando(null);
    }
  }

  return (
    <>
      <header className="cabecalho">
        <div>
          <Link to="/usuarios" className="botao-texto">
            ← Funcionários
          </Link>
          <h1>{novo ? 'Novo funcionário' : inicial.nome}</h1>
          {inicial && (
            <p className="mudo">
              <span className={`etiqueta etiqueta--${inicial.situacao.toLowerCase()}`}>
                {ROTULOS_SITUACAO[inicial.situacao]}
              </span>
              {inicial.acesso && <> · último acesso {formatarDataHora(inicial.acesso.ultimoLoginEm)}</>}
              {inicial.sessoesAtivas > 0 && <> · {inicial.sessoesAtivas} sessão(ões) aberta(s)</>}
            </p>
          )}
        </div>
      </header>

      {mensagem && (
        <p className={`alerta alerta--${mensagem.tipo}`} role={mensagem.tipo === 'erro' ? 'alert' : 'status'}>
          {mensagem.texto}
        </p>
      )}

      <form
        onSubmit={
          novo
            ? salvarNovo
            : (e) => (
                e.preventDefault(),
                void executar('dados', () => usuariosApi.atualizar(inicial.id, dados), 'Dados salvos.')
              )
        }
      >
        <section className="cartao">
          <h2>Dados pessoais</h2>
          <div className="grade-campos">
            <label className="campo campo--largo">
              <span>Nome completo *</span>
              <input {...campo('nome')} required maxLength={120} autoFocus={novo} />
            </label>
            <label className="campo">
              <span>CPF</span>
              <input {...campo('cpf')} inputMode="numeric" placeholder="000.000.000-00" maxLength={14} />
            </label>
            <label className="campo">
              <span>Telefone</span>
              <input {...campo('telefone')} inputMode="tel" placeholder="(11) 99999-9999" maxLength={20} />
            </label>
            <label className="campo">
              <span>E-mail</span>
              <input {...campo('email')} type="email" maxLength={160} />
            </label>
            <label className="campo">
              <span>Cargo</span>
              <input {...campo('cargo')} placeholder="Ex.: Operador de caixa" maxLength={80} />
            </label>
            <label className="campo">
              <span>Data de admissão</span>
              <input {...campo('dataAdmissao')} type="date" />
            </label>
          </div>
          {!novo && podeEditarDados && (
            <div className="acoes">
              <button type="submit" className="botao" disabled={salvando !== null}>
                {salvando === 'dados' ? 'Salvando…' : 'Salvar dados'}
              </button>
            </div>
          )}
        </section>

        <section className="cartao">
          <h2>Acesso ao sistema</h2>
          {ehVoceMesmo && (
            <p className="alerta alerta--info">
              Este é o seu usuário. Seu nível e suas permissões só podem ser alterados por outro
              administrador.
            </p>
          )}
          {!ehVoceMesmo && alvoEhAdmin && !souAdmin && (
            <p className="alerta alerta--info">
              Somente um Administrador pode alterar o acesso de outro Administrador.
            </p>
          )}

          {!inicial?.acesso && (
            <label className="opcao">
              <input
                type="checkbox"
                checked={comAcesso}
                disabled={!temPermissao('usuario.gerenciar')}
                onChange={(e) => setComAcesso(e.target.checked)}
              />
              Este funcionário vai usar o sistema (criar login)
            </label>
          )}

          {comAcesso && (
            <fieldset className="sem-borda" disabled={!podeEditarAcesso}>
              <div className="grade-campos">
                <label className="campo">
                  <span>Login *</span>
                  <input
                    value={login}
                    onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s/g, ''))}
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={60}
                    placeholder="ex.: joao.silva"
                  />
                </label>
                {precisaSenha && (
                  <label className="campo">
                    <span>Senha provisória *</span>
                    <div className="campo__senha">
                      <input
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)}
                        maxLength={POLITICA_SENHA.maximo}
                      />
                      <button type="button" className="botao-texto" onClick={() => setSenha(sugerirSenha())}>
                        Gerar
                      </button>
                    </div>
                    <small className={problemasSenha.length ? 'erro' : 'mudo'}>
                      {problemasSenha.length
                        ? problemasSenha.join('; ')
                        : 'O funcionário será obrigado a trocar no primeiro acesso.'}
                    </small>
                  </label>
                )}
              </div>

              <div className="niveis" role="radiogroup" aria-label="Nível de acesso">
                {NIVEIS_ACESSO.map((n) => (
                  <label key={n.codigo} className={`nivel${nivel === n.codigo ? ' nivel--ativo' : ''}`}>
                    <input
                      type="radio"
                      name="nivel"
                      value={n.codigo}
                      checked={nivel === n.codigo}
                      disabled={(n.codigo === 'admin' || n.codigo === 'gerente') && !souAdmin}
                      onChange={() => escolherNivel(n.codigo)}
                    />
                    <strong>{n.nome}</strong>
                    <span className="mudo">{n.descricao}</span>
                  </label>
                ))}
              </div>

              {nivel !== 'admin' ? (
                <SeletorPermissoes
                  catalogo={catalogo}
                  valor={permissoes}
                  onChange={setPermissoes}
                  podeConceder={podeConceder}
                  desabilitado={!podeEditarAcesso}
                />
              ) : (
                <p className="mudo">
                  O Administrador tem acesso a todas as funcionalidades, inclusive as que forem criadas no
                  futuro.
                </p>
              )}

              {!novo && podeEditarAcesso && (
                <div className="acoes">
                  <button
                    type="button"
                    className="botao"
                    disabled={salvando !== null || problemasSenha.length > 0}
                    onClick={() =>
                      void executar(
                        'acesso',
                        () => usuariosApi.definirAcesso(inicial.id, acessoParaEnvio()),
                        'Acesso salvo. As permissões já valem para as sessões abertas.',
                      )
                    }
                  >
                    {salvando === 'acesso' ? 'Salvando…' : 'Salvar acesso'}
                  </button>
                </div>
              )}
            </fieldset>
          )}
        </section>

        {novo && (
          <div className="acoes">
            <button type="submit" className="botao" disabled={salvando !== null || problemasSenha.length > 0}>
              {salvando ? 'Cadastrando…' : 'Cadastrar funcionário'}
            </button>
            <Link to="/usuarios" className="botao botao--secundario">
              Cancelar
            </Link>
          </div>
        )}
      </form>

      {inicial && (
        <Acoes
          inicial={inicial}
          podeEditarDados={podeEditarDados}
          podeEditarAcesso={podeEditarAcesso}
          ehVoceMesmo={ehVoceMesmo}
          dialogo={dialogo}
          setDialogo={setDialogo}
          aoConcluir={(t) => {
            setMensagem({ tipo: 'ok', texto: t });
            aoSalvar();
          }}
        />
      )}
    </>
  );
}

interface AcoesProps {
  inicial: FuncionarioDetalhe;
  podeEditarDados: boolean;
  podeEditarAcesso: boolean;
  ehVoceMesmo: boolean;
  dialogo: 'desativar' | 'reativar' | 'senha' | null;
  setDialogo: (d: 'desativar' | 'reativar' | 'senha' | null) => void;
  aoConcluir: (mensagem: string) => void;
}

function Acoes({
  inicial,
  podeEditarDados,
  podeEditarAcesso,
  ehVoceMesmo,
  dialogo,
  setDialogo,
  aoConcluir,
}: AcoesProps) {
  const { temPermissao } = useAuth();
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const bloqueado = inicial.situacao === 'BLOQUEADO';
  const podeDesativar = podeEditarDados && !ehVoceMesmo && (!inicial.acesso || podeEditarAcesso);

  const abrir = (d: typeof dialogo) => {
    setErro(null);
    setMotivo('');
    setSenha(d === 'senha' ? sugerirSenha() : '');
    setDialogo(d);
  };

  async function confirmar(acao: () => Promise<unknown>, sucesso: string) {
    setEnviando(true);
    setErro(null);
    try {
      await acao();
      setDialogo(null);
      aoConcluir(sucesso);
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao">
      <h2>Ações</h2>
      <div className="acoes acoes--quebrar">
        {inicial.acesso && podeEditarAcesso && (
          <button type="button" className="botao botao--secundario" onClick={() => abrir('senha')}>
            Redefinir senha
          </button>
        )}
        {bloqueado && podeEditarAcesso && (
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => void confirmar(() => usuariosApi.desbloquear(inicial.id), 'Conta desbloqueada.')}
          >
            Desbloquear conta
          </button>
        )}
        {inicial.ativo && podeDesativar && (
          <button type="button" className="botao botao--perigo" onClick={() => abrir('desativar')}>
            Desativar funcionário
          </button>
        )}
        {!inicial.ativo && podeDesativar && (
          <button type="button" className="botao" onClick={() => abrir('reativar')}>
            Reativar funcionário
          </button>
        )}
        {temPermissao('auditoria.ver') && inicial.acesso && (
          <Link to={`/atividades?usuarioId=${inicial.acesso.usuarioId}`} className="botao-texto">
            Ver atividades deste usuário
          </Link>
        )}
      </div>
      {erro && !dialogo && <p className="alerta alerta--erro">{erro}</p>}

      <Dialogo
        aberto={dialogo === 'desativar' || dialogo === 'reativar'}
        titulo={dialogo === 'desativar' ? `Desativar ${inicial.nome}?` : `Reativar ${inicial.nome}?`}
        textoConfirmar={dialogo === 'desativar' ? 'Desativar' : 'Reativar'}
        perigo={dialogo === 'desativar'}
        enviando={enviando}
        erro={erro}
        onFechar={() => setDialogo(null)}
        onConfirmar={() =>
          void confirmar(
            () =>
              dialogo === 'desativar'
                ? usuariosApi.desativar(inicial.id, motivo)
                : usuariosApi.reativar(inicial.id, motivo),
            dialogo === 'desativar'
              ? 'Funcionário desativado. As sessões dele foram encerradas.'
              : 'Funcionário reativado.',
          )
        }
      >
        {dialogo === 'desativar' && (
          <p className="mudo">
            O acesso ao sistema é bloqueado na hora e as sessões abertas são encerradas. O histórico é
            mantido.
          </p>
        )}
        <label className="campo">
          <span>Motivo *</span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
            minLength={3}
            maxLength={255}
            autoFocus
          />
        </label>
      </Dialogo>

      <Dialogo
        aberto={dialogo === 'senha'}
        titulo="Redefinir senha"
        textoConfirmar="Redefinir"
        enviando={enviando}
        erro={erro}
        onFechar={() => setDialogo(null)}
        onConfirmar={() =>
          void confirmar(
            () => usuariosApi.redefinirSenha(inicial.id, senha),
            `Senha redefinida. Informe a senha provisória "${senha}" ao funcionário; ele vai trocá-la no próximo acesso.`,
          )
        }
      >
        <p className="mudo">As sessões abertas deste usuário serão encerradas.</p>
        <label className="campo">
          <span>Senha provisória</span>
          <input value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
      </Dialogo>
    </section>
  );
}
