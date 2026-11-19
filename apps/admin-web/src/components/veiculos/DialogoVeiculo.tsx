import { useState } from 'react';
import { Link } from 'react-router';
import { normalizarPlaca, placaValida, type Categoria, type VeiculoDetalhe } from '@estacionamento/shared';
import { ErroDaApi } from '../../services/api';
import { veiculosApi } from '../../services/veiculos';
import { Dialogo } from '../Dialogo';
import { mensagemDeErro } from '../vagas/Dialogos';

interface Props {
  aberto: boolean;
  veiculo: VeiculoDetalhe | null; // null = novo
  placaInicial?: string;
  categorias: Categoria[];
  onFechar: () => void;
  onSalvo: (v: VeiculoDetalhe) => void;
}

export function DialogoVeiculo({ aberto, veiculo, placaInicial = '', categorias, onFechar, onSalvo }: Props) {
  const ativas = categorias.filter((c) => c.ativo || c.id === veiculo?.categoriaId);
  const [placa, setPlaca] = useState(veiculo?.placa ?? placaInicial);
  const [estrangeira, setEstrangeira] = useState(veiculo?.placaEstrangeira ?? false);
  const [categoriaId, setCategoriaId] = useState(veiculo?.categoriaId ?? ativas[0]?.id ?? '');
  const [marca, setMarca] = useState(veiculo?.marca ?? '');
  const [modelo, setModelo] = useState(veiculo?.modelo ?? '');
  const [cor, setCor] = useState(veiculo?.cor ?? '');
  const [observacoes, setObservacoes] = useState(veiculo?.observacoes ?? '');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [existente, setExistente] = useState<string | null>(null);

  const normalizada = normalizarPlaca(placa);
  const placaOk = !normalizada || placaValida(normalizada, estrangeira);
  const mudouPlaca = veiculo !== null && normalizada !== veiculo.placa;

  async function salvar() {
    setEnviando(true);
    setErro(null);
    setExistente(null);
    const dados = {
      placa,
      placaEstrangeira: estrangeira,
      categoriaId,
      marca: marca || null,
      modelo: modelo || null,
      cor: cor || null,
      observacoes: observacoes || null,
    };
    try {
      onSalvo(
        veiculo
          ? await veiculosApi.editar(veiculo.id, { ...dados, motivo: motivo || undefined })
          : await veiculosApi.criar(dados),
      );
    } catch (e) {
      setErro(mensagemDeErro(e));
      const id =
        e instanceof ErroDaApi && !Array.isArray(e.corpo.detalhes)
          ? (e.corpo.detalhes?.veiculoId as string | undefined)
          : undefined;
      setExistente(id ?? null);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      titulo={veiculo ? 'Editar veículo' : 'Novo veículo'}
      textoConfirmar={veiculo ? 'Salvar' : 'Cadastrar'}
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void salvar()}
    >
      {existente && (
        <p className="pequeno">
          <Link to={`/veiculos/${existente}`} onClick={onFechar}>
            Abrir o cadastro existente
          </Link>
        </p>
      )}
      <label className="campo">
        <span>Placa *</span>
        <input
          value={placa}
          onChange={(e) => setPlaca(e.target.value.toUpperCase())}
          required
          maxLength={12}
          className="entrada-placa"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          aria-invalid={!placaOk}
        />
        <small className={placaOk ? 'mudo' : 'erro'}>
          {placaOk
            ? 'Padrão antigo (ABC1234) ou Mercosul (ABC1D23).'
            : 'Placa fora do padrão brasileiro. Se for estrangeira, marque abaixo.'}
        </small>
      </label>
      <label className="opcao opcao--compacta">
        <input type="checkbox" checked={estrangeira} onChange={(e) => setEstrangeira(e.target.checked)} />{' '}
        Placa estrangeira
      </label>
      <label className="campo">
        <span>Categoria *</span>
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
          {ativas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      <div className="grade-campos">
        <label className="campo">
          <span>Marca</span>
          <input value={marca} onChange={(e) => setMarca(e.target.value)} maxLength={40} />
        </label>
        <label className="campo">
          <span>Modelo</span>
          <input value={modelo} onChange={(e) => setModelo(e.target.value)} maxLength={60} />
        </label>
        <label className="campo">
          <span>Cor</span>
          <input value={cor} onChange={(e) => setCor(e.target.value)} maxLength={30} list="cores-comuns" />
          <datalist id="cores-comuns">
            {['Branco', 'Preto', 'Prata', 'Cinza', 'Vermelho', 'Azul', 'Verde', 'Amarelo', 'Marrom'].map(
              (c) => (
                <option key={c} value={c} />
              ),
            )}
          </datalist>
        </label>
      </div>
      <label className="campo">
        <span>Observações</span>
        <input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={500} />
      </label>
      {mudouPlaca && (
        <>
          <p className="alerta alerta--info pequeno">
            Correção de placa: os tickets antigos continuam com a placa registrada na época
            {veiculo?.estadiaAtual ? '; o ticket aberto agora passa a usar a placa nova' : ''}.
          </p>
          <label className="campo">
            <span>Motivo da correção</span>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={255}
              placeholder="Ex.: placa digitada errada"
            />
          </label>
        </>
      )}
    </Dialogo>
  );
}
