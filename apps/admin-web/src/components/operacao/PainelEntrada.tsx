import { useEffect, useState, type FormEvent } from 'react';
import {
  formatarPlaca,
  normalizarPlaca,
  placaValida,
  type Categoria,
  type ConsultaPlaca,
  type Modalidade,
  type ResultadoEntrada,
  type VagaLivre,
} from '@estacionamento/shared';
import { sessoesApi } from '../../services/sessoes';
import { veiculosApi } from '../../services/veiculos';
import { mensagemDeErro } from '../vagas/Dialogos';

interface Props {
  categorias: Categoria[];
  /** Muda a cada entrada/saída para recarregar as vagas livres. */
  rodada: number;
  onEntrou: (r: ResultadoEntrada) => void;
  /** O veículo digitado já está dentro: leva para a saída. */
  onIrParaSaida: (placa: string) => void;
}

export function PainelEntrada({ categorias, rodada, onEntrou, onIrParaSaida }: Props) {
  const ativas = categorias.filter((c) => c.ativo);
  const [placa, setPlaca] = useState('');
  const [estrangeira, setEstrangeira] = useState(false);
  const [consulta, setConsulta] = useState<ConsultaPlaca | null>(null);
  const [categoriaEscolhida, setCategoriaEscolhida] = useState('');
  const [vagaId, setVagaId] = useState('');
  const [vagas, setVagas] = useState<VagaLivre[] | null>(null);
  const [modalidade, setModalidade] = useState<Modalidade>('AVULSO');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const normalizada = normalizarPlaca(placa);
  const valida = !!normalizada && placaValida(normalizada, estrangeira);
  const veiculo = consulta?.placa === normalizada ? consulta.veiculo : null;
  const consultada = consulta?.placa === normalizada;
  const categoriaId = veiculo?.categoriaId ?? (categoriaEscolhida || ativas[0]?.id || '');
  const categoria = categorias.find((c) => c.id === categoriaId);

  // Reconhece o veículo enquanto o operador digita
  useEffect(() => {
    if (!valida) return;
    let ativo = true;
    const t = setTimeout(() => {
      veiculosApi
        .consultarPlaca(normalizada)
        .then((r) => ativo && setConsulta(r))
        .catch(() => undefined);
    }, 250);
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [normalizada, valida]);

  // Vagas livres da categoria (atualiza a cada entrada/saída)
  useEffect(() => {
    if (!categoriaId) return;
    let ativo = true;
    sessoesApi
      .vagasLivres(categoriaId)
      .then((r) => {
        if (!ativo) return;
        setVagas(r.itens);
        setVagaId((v) => (r.itens.some((x) => x.id === v) ? v : ''));
      })
      .catch(() => ativo && setVagas(null));
    return () => {
      ativo = false;
    };
  }, [categoriaId, rodada]);

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await sessoesApi.entrada({
        placa: normalizada,
        placaEstrangeira: estrangeira,
        categoriaId: veiculo ? undefined : categoriaId,
        vagaId: vagaId || null,
        modalidade,
        modelo: veiculo ? undefined : modelo.trim() || null,
        cor: veiculo ? undefined : cor.trim() || null,
      });
      setPlaca('');
      setConsulta(null);
      setVagaId('');
      setModalidade('AVULSO');
      setModelo('');
      setCor('');
      setEstrangeira(false);
      onEntrou(r);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  const lotado = vagas !== null && vagas.length === 0;
  const jaDentro = veiculo?.estadiaAtual ?? null;

  return (
    <form className="cartao painel-op" onSubmit={registrar} aria-labelledby="titulo-entrada">
      <h2 id="titulo-entrada">Entrada</h2>
      <label className="campo">
        <span>Placa</span>
        <input
          value={placa}
          onChange={(e) => {
            setPlaca(e.target.value.toUpperCase());
            setErro(null);
          }}
          placeholder="ABC1D23"
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="entrada-placa"
          aria-describedby="info-veiculo"
          aria-invalid={!!normalizada && !valida}
          required
          autoFocus
        />
      </label>
      <label className="opcao opcao--compacta">
        <input type="checkbox" checked={estrangeira} onChange={(e) => setEstrangeira(e.target.checked)} />
        Placa estrangeira
      </label>

      <div id="info-veiculo" aria-live="polite">
        {normalizada && !valida && <p className="pequeno erro">Placa inválida (ABC1234 ou ABC1D23).</p>}
        {valida && consultada && veiculo && !jaDentro && (
          <p className="alerta alerta--info">
            <strong>Veículo cadastrado:</strong>{' '}
            {[veiculo.categoria, veiculo.marca, veiculo.modelo, veiculo.cor].filter(Boolean).join(' · ')}
            {veiculo.totalEstadias > 0 && ` — ${veiculo.totalEstadias} estadia(s) anteriores`}
          </p>
        )}
        {valida && consultada && !veiculo && (
          <p className="alerta alerta--info">Placa nova: o veículo será cadastrado agora.</p>
        )}
        {jaDentro && (
          <p className="alerta alerta--erro">
            {formatarPlaca(normalizada)} já está estacionado na vaga {jaDentro.vaga ?? '—'} (ticket nº{' '}
            {jaDentro.numero}).{' '}
            <button type="button" className="botao-texto" onClick={() => onIrParaSaida(normalizada)}>
              Ir para a saída
            </button>
          </p>
        )}
      </div>

      {!veiculo && (
        <div className="grade-campos">
          <label className="campo">
            <span>Categoria *</span>
            <select value={categoriaId} onChange={(e) => setCategoriaEscolhida(e.target.value)} required>
              {ativas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Modelo</span>
            <input
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              maxLength={60}
              placeholder="Opcional"
            />
          </label>
          <label className="campo">
            <span>Cor</span>
            <input
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              maxLength={30}
              placeholder="Opcional"
            />
          </label>
        </div>
      )}

      <div className="grade-campos">
        <label className="campo">
          <span>Vaga</span>
          <select value={vagaId} onChange={(e) => setVagaId(e.target.value)} disabled={lotado}>
            <option value="">Automática (primeira livre)</option>
            {vagas?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.codigo}
                {v.setor ? ` · ${v.setor}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Cobrança</span>
          <select value={modalidade} onChange={(e) => setModalidade(e.target.value as Modalidade)}>
            <option value="AVULSO">Por tempo (avulso)</option>
            <option value="DIARIA">Diária</option>
          </select>
        </label>
      </div>

      {vagas && categoria && (
        <p className={`pequeno ${lotado ? 'erro' : 'mudo'}`} role="status">
          {lotado
            ? `Lotado: não há vagas livres para ${categoria.nome}.`
            : `${vagas.length} vaga(s) livre(s) para ${categoria.nome}.`}
        </p>
      )}
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      <button
        type="submit"
        className="botao botao--bloco"
        disabled={enviando || !valida || lotado || !!jaDentro}
      >
        {enviando ? 'Registrando…' : 'Registrar entrada'}
      </button>
    </form>
  );
}
