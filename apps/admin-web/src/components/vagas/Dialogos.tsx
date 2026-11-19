import { useState } from 'react';
import { gerarCodigosVaga, type Categoria, type Vaga } from '@estacionamento/shared';
import { ErroDaApi } from '../../services/api';
import { vagasApi } from '../../services/vagas';
import { Dialogo } from '../Dialogo';

export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroDaApi) {
    const d = e.corpo.detalhes;
    const extras = Array.isArray(d) ? d.map((x) => x.mensagem).filter((m) => m !== e.message) : [];
    return extras.length ? `${e.message}: ${extras.join('; ')}` : e.message;
  }
  return e instanceof Error ? e.message : 'Erro inesperado';
}

/** Executa a ação do diálogo, controlando "enviando" e erro. */
function useEnvio(onConcluir: (msg: string) => void) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const enviar = async (acao: () => Promise<string>) => {
    setEnviando(true);
    setErro(null);
    try {
      onConcluir(await acao());
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, erro, enviar };
}

const prefixoSugerido = (c?: Categoria) =>
  c?.codigo === 'MOTO' ? 'M-' : c?.codigo === 'CARRO' ? 'A-' : `${c?.codigo.slice(0, 1) ?? 'V'}-`;

// ---------------------------------------------------------------------------
interface DialogoVagaProps {
  aberto: boolean;
  vaga: Vaga | null; // null = nova
  categorias: Categoria[];
  setores: string[];
  onFechar: () => void;
  onConcluir: (msg: string, id?: string) => void;
}

export function DialogoVaga({ aberto, vaga, categorias, setores, onFechar, onConcluir }: DialogoVagaProps) {
  const ativas = categorias.filter((c) => c.ativo);
  const [modo, setModo] = useState<'uma' | 'lote'>('uma');
  const [codigo, setCodigo] = useState(vaga?.codigo ?? '');
  const [categoriaId, setCategoriaId] = useState(vaga?.categoriaId ?? ativas[0]?.id ?? '');
  const [setor, setSetor] = useState(vaga?.setor ?? '');
  const [coberta, setCoberta] = useState(vaga?.coberta ?? false);
  const [observacao, setObservacao] = useState(vaga?.observacao ?? '');
  const [prefixo, setPrefixo] = useState(prefixoSugerido(ativas[0]));
  const [inicio, setInicio] = useState(1);
  const [quantidade, setQuantidade] = useState(10);
  const [digitos, setDigitos] = useState(2);
  const { enviando, erro, enviar } = useEnvio((m) => onConcluir(m));

  const previa =
    modo === 'lote' && quantidade > 0 && quantidade <= 500
      ? gerarCodigosVaga(prefixo, inicio, quantidade, digitos)
      : [];

  const confirmar = () =>
    void enviar(async () => {
      const comuns = { categoriaId, setor: setor || null, coberta };
      if (vaga) {
        await vagasApi.editar(vaga.id, { ...comuns, codigo, observacao: observacao || null });
        return `Vaga ${codigo.toUpperCase()} atualizada.`;
      }
      if (modo === 'uma') {
        const v = await vagasApi.criar({ ...comuns, codigo, observacao: observacao || null });
        return `Vaga ${v.codigo} cadastrada.`;
      }
      const r = await vagasApi.criarLote({ ...comuns, prefixo, inicio, quantidade, digitos });
      return `${r.criadas.length} vagas cadastradas (${r.criadas[0]} a ${r.criadas.at(-1)}).`;
    });

  return (
    <Dialogo
      aberto={aberto}
      titulo={vaga ? `Editar vaga ${vaga.codigo}` : 'Nova vaga'}
      textoConfirmar={vaga ? 'Salvar' : modo === 'lote' ? `Cadastrar ${previa.length} vagas` : 'Cadastrar'}
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={confirmar}
    >
      {!vaga && (
        <div className="abas" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'uma'}
            className={modo === 'uma' ? 'aba aba--ativa' : 'aba'}
            onClick={() => setModo('uma')}
          >
            Uma vaga
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'lote'}
            className={modo === 'lote' ? 'aba aba--ativa' : 'aba'}
            onClick={() => setModo('lote')}
          >
            Várias vagas
          </button>
        </div>
      )}
      <label className="campo">
        <span>Categoria *</span>
        <select
          value={categoriaId}
          onChange={(e) => {
            setCategoriaId(e.target.value);
            if (!vaga) setPrefixo(prefixoSugerido(ativas.find((c) => c.id === e.target.value)));
          }}
          required
        >
          {ativas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      {modo === 'uma' || vaga ? (
        <label className="campo">
          <span>Código da vaga *</span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            required
            maxLength={20}
            placeholder="Ex.: A-01"
            autoFocus
          />
          <small className="mudo">Identificação única, pintada no piso. Letras, números e hífen.</small>
        </label>
      ) : (
        <>
          <div className="grade-campos grade-campos--4">
            <label className="campo">
              <span>Prefixo</span>
              <input
                value={prefixo}
                onChange={(e) => setPrefixo(e.target.value.toUpperCase())}
                maxLength={15}
              />
            </label>
            <label className="campo">
              <span>Começar em</span>
              <input
                type="number"
                min={0}
                value={inicio}
                onChange={(e) => setInicio(Number(e.target.value))}
              />
            </label>
            <label className="campo">
              <span>Quantidade</span>
              <input
                type="number"
                min={1}
                max={500}
                value={quantidade}
                onChange={(e) => setQuantidade(Number(e.target.value))}
              />
            </label>
            <label className="campo">
              <span>Dígitos</span>
              <input
                type="number"
                min={1}
                max={5}
                value={digitos}
                onChange={(e) => setDigitos(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="mudo pequeno">
            {previa.length
              ? `Serão criadas: ${previa.slice(0, 3).join(', ')}${previa.length > 3 ? ` … ${previa.at(-1)}` : ''}`
              : 'Informe de 1 a 500 vagas.'}
          </p>
        </>
      )}
      <label className="campo">
        <span>Setor</span>
        <input
          value={setor}
          onChange={(e) => setSetor(e.target.value)}
          list="setores-existentes"
          maxLength={40}
          placeholder="Ex.: Térreo, Subsolo"
        />
        <datalist id="setores-existentes">
          {setores.filter(Boolean).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label className="opcao">
        <input type="checkbox" checked={coberta} onChange={(e) => setCoberta(e.target.checked)} /> Vaga
        coberta
      </label>
      {(modo === 'uma' || vaga) && (
        <label className="campo">
          <span>Observação</span>
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={255} />
        </label>
      )}
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
interface DialogoMotivoProps {
  aberto: boolean;
  titulo: string;
  texto: string;
  textoConfirmar: string;
  perigo?: boolean;
  sugestoes?: string[];
  onFechar: () => void;
  acao: (motivo: string) => Promise<string>;
  onConcluir: (msg: string) => void;
}

export function DialogoMotivo({
  aberto,
  titulo,
  texto,
  textoConfirmar,
  perigo,
  sugestoes = [],
  onFechar,
  acao,
  onConcluir,
}: DialogoMotivoProps) {
  const [motivo, setMotivo] = useState('');
  const { enviando, erro, enviar } = useEnvio(onConcluir);
  return (
    <Dialogo
      aberto={aberto}
      titulo={titulo}
      textoConfirmar={textoConfirmar}
      perigo={perigo}
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void enviar(() => acao(motivo))}
    >
      <p className="mudo">{texto}</p>
      <label className="campo">
        <span>Motivo *</span>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          required
          minLength={3}
          maxLength={255}
          autoFocus
          list="sugestoes-motivo"
        />
        <datalist id="sugestoes-motivo">
          {sugestoes.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
interface DialogoCapacidadeProps {
  aberto: boolean;
  categorias: Categoria[];
  ocupadasPorCategoria: Record<string, number>;
  /** Setor mais comum de cada categoria: sugestão para as vagas novas. */
  setorPorCategoria: Record<string, string>;
  onFechar: () => void;
  onConcluir: (msg: string) => void;
}

export function DialogoCapacidade({
  aberto,
  categorias,
  ocupadasPorCategoria,
  setorPorCategoria,
  onFechar,
  onConcluir,
}: DialogoCapacidadeProps) {
  const ativas = categorias.filter((c) => c.ativo);
  const [categoriaId, setCategoriaId] = useState(ativas[0]?.id ?? '');
  const categoria = ativas.find((c) => c.id === categoriaId);
  const [nova, setNova] = useState(categoria?.capacidade ?? 0);
  const [prefixo, setPrefixo] = useState(prefixoSugerido(categoria));
  const [setor, setSetor] = useState(setorPorCategoria[categoriaId] ?? '');
  const [motivo, setMotivo] = useState('');
  const { enviando, erro, enviar } = useEnvio(onConcluir);

  const atual = categoria?.capacidade ?? 0;
  const minimo = ocupadasPorCategoria[categoriaId] ?? 0;
  const diferenca = nova - atual;
  const previa =
    diferenca > 0
      ? `Serão adicionadas ${diferenca} vaga(s): primeiro são reativadas as removidas desta categoria; o restante é criado com o prefixo ${prefixo}.`
      : diferenca < 0
        ? `Serão removidas ${-diferenca} vaga(s): primeiro as bloqueadas, depois as livres de código mais alto. Vagas ocupadas nunca são removidas. As que já tiveram veículos ficam no histórico.`
        : 'A capacidade não muda.';

  return (
    <Dialogo
      aberto={aberto}
      titulo="Configurar capacidade"
      textoConfirmar="Aplicar"
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() =>
        void enviar(async () => {
          const r = await vagasApi.capacidade({
            categoriaId,
            capacidade: nova,
            prefixo,
            setor: setor || null,
            motivo,
          });
          const partes = [
            r.criadas.length && `${r.criadas.length} criada(s)`,
            r.reativadas.length && `${r.reativadas.length} reativada(s)`,
            r.excluidas.length && `${r.excluidas.length} excluída(s)`,
            r.desativadas.length && `${r.desativadas.length} removida(s) mantendo o histórico`,
          ].filter(Boolean);
          return `${r.categoria}: capacidade de ${r.anterior} para ${r.nova} vagas (${partes.join(', ')}).`;
        })
      }
    >
      <label className="campo">
        <span>Categoria</span>
        <select
          value={categoriaId}
          onChange={(e) => {
            const c = ativas.find((x) => x.id === e.target.value);
            setCategoriaId(e.target.value);
            setNova(c?.capacidade ?? 0);
            setPrefixo(prefixoSugerido(c));
            setSetor(setorPorCategoria[e.target.value] ?? '');
          }}
        >
          {ativas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} — {c.capacidade} vagas
            </option>
          ))}
        </select>
      </label>
      <label className="campo">
        <span>Nova capacidade (vagas)</span>
        <input
          type="number"
          min={minimo}
          max={5000}
          value={nova}
          onChange={(e) => setNova(Number(e.target.value))}
          required
        />
        <small className="mudo">
          Atual: {atual} · mínimo agora: {minimo} (vagas ocupadas)
        </small>
      </label>
      {diferenca > 0 && (
        <div className="grade-campos">
          <label className="campo">
            <span>Prefixo das novas</span>
            <input
              value={prefixo}
              onChange={(e) => setPrefixo(e.target.value.toUpperCase())}
              maxLength={15}
            />
          </label>
          <label className="campo">
            <span>Setor das novas</span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} maxLength={40} />
          </label>
        </div>
      )}
      <p className={`alerta ${diferenca < 0 ? 'alerta--erro' : 'alerta--info'}`}>{previa}</p>
      <label className="campo">
        <span>Motivo *</span>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          required
          minLength={3}
          maxLength={255}
          placeholder="Ex.: ampliação do pátio"
        />
      </label>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
interface DialogoCategoriasProps {
  aberto: boolean;
  categorias: Categoria[];
  onFechar: () => void;
  onAlterou: () => void;
}

export function DialogoCategorias({ aberto, categorias, onFechar, onAlterou }: DialogoCategoriasProps) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const executar = async (acao: () => Promise<unknown>) => {
    setEnviando(true);
    setErro(null);
    try {
      await acao();
      onAlterou();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      aberto={aberto}
      titulo="Categorias de veículo"
      textoConfirmar="Adicionar categoria"
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() =>
        void executar(async () => {
          await vagasApi.criarCategoria(nome, nome);
          setNome('');
        })
      }
    >
      <ul className="lista-categorias">
        {categorias.map((c) => (
          <li key={c.id}>
            <span>
              <strong>{c.nome}</strong> <span className="mudo">· {c.capacidade} vagas</span>
            </span>
            <label className="opcao opcao--compacta">
              <input
                type="checkbox"
                checked={c.ativo}
                disabled={enviando}
                onChange={(e) =>
                  void executar(() => vagasApi.editarCategoria(c.id, c.nome, e.target.checked))
                }
              />
              Ativa
            </label>
          </li>
        ))}
        {categorias.length === 0 && <li className="mudo">Nenhuma categoria cadastrada.</li>}
      </ul>
      <label className="campo">
        <span>Nova categoria</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          minLength={2}
          maxLength={60}
          placeholder="Ex.: Van, Caminhão, Bicicleta"
        />
      </label>
    </Dialogo>
  );
}
