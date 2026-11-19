import { useState } from 'react';
import {
  calcularTarifa,
  centavosParaCampo,
  DIAS_SEMANA,
  formatarCentavos,
  lerCentavos,
  problemasDaRegra,
  regraDeDados,
  type AplicacaoEspecial,
  type Categoria,
  type DadosRegra,
  type RegraCadastrada,
  type TabelaTarifaDetalhe,
  type TipoRegra,
} from '@estacionamento/shared';
import { tarifasApi } from '../../services/tarifas';
import { Dialogo } from '../Dialogo';
import { mensagemDeErro } from '../vagas/Dialogos';
import { duracaoCurta } from '../vagas/MapaVagas';

interface Props {
  tabelaId: string;
  /** Regra existente (editar) ou modelo para uma nova. */
  regra: RegraCadastrada | null;
  nova: { categoriaId: string; tipo: TipoRegra } | null;
  categorias: Categoria[];
  /** Regra padrão da categoria: base de valores para uma especial nova. */
  modelo?: RegraCadastrada;
  onFechar: () => void;
  onSalvo: (t: TabelaTarifaDetalhe) => void;
}

const campo = (v: number | null | undefined) => (v === null || v === undefined ? '' : centavosParaCampo(v));
const EXEMPLOS = [15, 60, 80, 150, 300, 720, 1500];

export function DialogoRegra({ tabelaId, regra, nova, categorias, modelo, onFechar, onSalvo }: Props) {
  const base = regra ?? modelo;
  const tipo = regra?.tipo ?? nova!.tipo;
  const categoriaId = regra?.categoriaId ?? nova!.categoriaId;
  const categoria = categorias.find((c) => c.id === categoriaId)?.nome ?? '';
  const especial = tipo === 'ESPECIAL';

  const [nome, setNome] = useState(regra?.nome ?? '');
  const [aplicacao, setAplicacao] = useState<AplicacaoEspecial>(regra?.aplicacao ?? 'AUTOMATICA');
  const [dias, setDias] = useState<number>(regra?.diasSemana ?? 127);
  const [comHorario, setComHorario] = useState(!!regra?.horaInicio);
  const [horaInicio, setHoraInicio] = useState(regra?.horaInicio ?? '18:00');
  const [horaFim, setHoraFim] = useState(regra?.horaFim ?? '06:00');
  const [fixo, setFixo] = useState(
    regra?.valorFixoCentavos !== null && regra?.valorFixoCentavos !== undefined,
  );
  const [valorFixo, setValorFixo] = useState(campo(regra?.valorFixoCentavos));
  const [primeiraHora, setPrimeiraHora] = useState(campo(base?.primeiraHoraCentavos));
  const [horaAdicional, setHoraAdicional] = useState(campo(base?.horaAdicionalCentavos));
  const [comFracao, setComFracao] = useState(base ? base.fracaoMin !== null : true);
  const [fracaoMin, setFracaoMin] = useState(String(base?.fracaoMin ?? 15));
  const [fracao, setFracao] = useState(campo(base?.fracaoCentavos));
  const [carencia, setCarencia] = useState(String(base?.carenciaMin ?? 0));
  const [teto, setTeto] = useState(campo(base?.diariaMaximaCentavos));
  const [diaria, setDiaria] = useState(campo(base?.diariaCentavos));
  const [tolerancia, setTolerancia] = useState(String(base?.toleranciaMin ?? 10));
  const [ativo, setAtivo] = useState(regra?.ativo ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcional = (t: string) => (t.trim() ? lerCentavos(t) : null);
  const inteiro = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t) : NaN);
  const automatica = especial && aplicacao === 'AUTOMATICA';

  const dados: DadosRegra = {
    categoriaId,
    tipo,
    nome: especial ? nome.trim() || null : null,
    aplicacao: especial ? aplicacao : null,
    diasSemana: automatica ? dias : null,
    horaInicio: automatica && comHorario ? horaInicio : null,
    horaFim: automatica && comHorario ? horaFim : null,
    ativo,
    toleranciaMin: inteiro(tolerancia),
    primeiraHoraCentavos: fixo ? 0 : (lerCentavos(primeiraHora) ?? NaN),
    horaAdicionalCentavos: fixo ? 0 : (lerCentavos(horaAdicional) ?? NaN),
    fracaoMin: !fixo && comFracao ? inteiro(fracaoMin) : null,
    fracaoCentavos: !fixo && comFracao ? (lerCentavos(fracao) ?? NaN) : null,
    carenciaMin: fixo ? 0 : inteiro(carencia),
    diariaMaximaCentavos: fixo ? null : opcional(teto),
    diariaCentavos: opcional(diaria),
    valorFixoCentavos: especial && fixo ? (lerCentavos(valorFixo) ?? NaN) : null,
  };
  const numeros = [
    dados.toleranciaMin,
    dados.primeiraHoraCentavos,
    dados.horaAdicionalCentavos,
    dados.fracaoMin,
    dados.fracaoCentavos,
    dados.carenciaMin,
    dados.valorFixoCentavos,
  ];
  const incompleto =
    numeros.some((v) => Number.isNaN(v)) ||
    (!fixo && teto.trim() && dados.diariaMaximaCentavos === null) ||
    (diaria.trim() && dados.diariaCentavos === null);
  const problemas = incompleto
    ? ['Preencha os valores (ex.: 10,00) e os minutos com números inteiros.']
    : problemasDaRegra(regraDeDados(dados));
  if (automatica && dias === 0) problemas.push('Escolha ao menos um dia da semana.');
  if (automatica && comHorario && horaInicio === horaFim)
    problemas.push('Início e fim do horário não podem ser iguais.');

  async function salvar() {
    if (especial && !nome.trim()) return setErro('Dê um nome à tarifa especial.');
    if (problemas.length) return setErro(problemas[0]!);
    setEnviando(true);
    setErro(null);
    try {
      onSalvo(await tarifasApi.salvarRegra(tabelaId, regra?.id ?? null, dados));
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const titulo = regra
    ? `Editar ${especial ? `"${regra.nome}"` : 'tarifa padrão'} · ${categoria}`
    : especial
      ? `Nova tarifa especial · ${categoria}`
      : `Tarifa padrão · ${categoria}`;

  return (
    <Dialogo
      aberto
      titulo={titulo}
      textoConfirmar="Salvar na nova versão"
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void salvar()}
      largo
    >
      {especial && (
        <fieldset className="grupo-form">
          <legend>Quando vale</legend>
          <label className="campo">
            <span>Nome *</span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              placeholder="Ex.: Noturno, Fim de semana, Convênio Farmácia"
              autoFocus
              required
            />
          </label>
          <div className="opcoes-linha" role="radiogroup" aria-label="Como a tarifa é aplicada">
            <label className="opcao opcao--compacta">
              <input
                type="radio"
                checked={aplicacao === 'AUTOMATICA'}
                onChange={() => setAplicacao('AUTOMATICA')}
              />
              Automática no dia/horário da entrada
            </label>
            <label className="opcao opcao--compacta">
              <input type="radio" checked={aplicacao === 'MANUAL'} onChange={() => setAplicacao('MANUAL')} />O
              operador escolhe na entrada (convênio, evento)
            </label>
          </div>
          {automatica && (
            <>
              <div className="dias-semana" role="group" aria-label="Dias da semana">
                {DIAS_SEMANA.map((d, i) => (
                  <label key={d} className={`chip${dias & (1 << i) ? ' chip--ativo' : ''}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={(dias & (1 << i)) !== 0}
                      onChange={() => setDias((x) => x ^ (1 << i))}
                    />
                    {d}
                  </label>
                ))}
              </div>
              <label className="opcao opcao--compacta">
                <input
                  type="checkbox"
                  checked={comHorario}
                  onChange={(e) => setComHorario(e.target.checked)}
                />
                Só para entradas em um horário
              </label>
              {comHorario && (
                <div className="grade-campos grade-campos--estreita">
                  <label className="campo">
                    <span>Entrada a partir de</span>
                    <input
                      type="time"
                      value={horaInicio}
                      onChange={(e) => setHoraInicio(e.target.value)}
                      required
                    />
                  </label>
                  <label className="campo">
                    <span>Até</span>
                    <input
                      type="time"
                      value={horaFim}
                      onChange={(e) => setHoraFim(e.target.value)}
                      required
                    />
                  </label>
                </div>
              )}
              {comHorario && horaInicio > horaFim && (
                <p className="pequeno mudo">
                  Atravessa a meia-noite: a madrugada conta como o dia em que o horário começou.
                </p>
              )}
            </>
          )}
        </fieldset>
      )}

      <fieldset className="grupo-form">
        <legend>Preço</legend>
        {especial && (
          <div className="opcoes-linha" role="radiogroup" aria-label="Tipo de cobrança">
            <label className="opcao opcao--compacta">
              <input type="radio" checked={!fixo} onChange={() => setFixo(false)} />
              Por tempo
            </label>
            <label className="opcao opcao--compacta">
              <input type="radio" checked={fixo} onChange={() => setFixo(true)} />
              Preço fixo
            </label>
          </div>
        )}
        {fixo ? (
          <label className="campo">
            <span>Preço fixo por 24h (R$)</span>
            <input
              value={valorFixo}
              onChange={(e) => setValorFixo(e.target.value)}
              inputMode="decimal"
              required
            />
          </label>
        ) : (
          <>
            <div className="grade-campos grade-campos--estreita">
              <label className="campo">
                <span>1ª hora (R$)</span>
                <input
                  value={primeiraHora}
                  onChange={(e) => setPrimeiraHora(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <label className="campo">
                <span>Hora adicional (R$)</span>
                <input
                  value={horaAdicional}
                  onChange={(e) => setHoraAdicional(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
            </div>
            <label className="opcao opcao--compacta">
              <input type="checkbox" checked={comFracao} onChange={(e) => setComFracao(e.target.checked)} />
              Depois da 1ª hora, cobrar por fração de hora
            </label>
            {comFracao && (
              <div className="grade-campos grade-campos--estreita">
                <label className="campo">
                  <span>Fração (min)</span>
                  <input
                    value={fracaoMin}
                    onChange={(e) => setFracaoMin(e.target.value)}
                    inputMode="numeric"
                    required
                  />
                </label>
                <label className="campo">
                  <span>Valor da fração (R$)</span>
                  <input
                    value={fracao}
                    onChange={(e) => setFracao(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
              </div>
            )}
            <div className="grade-campos grade-campos--estreita">
              <label className="campo">
                <span>Carência por período (min)</span>
                <input value={carencia} onChange={(e) => setCarencia(e.target.value)} inputMode="numeric" />
                <small className="mudo">
                  0 = arredonda para cima. Ex.: 5 → só cobra a próxima {comFracao ? 'fração' : 'hora'} depois
                  de 5 min.
                </small>
              </label>
              <label className="campo">
                <span>Diária máxima (R$)</span>
                <input
                  value={teto}
                  onChange={(e) => setTeto(e.target.value)}
                  inputMode="decimal"
                  placeholder="Sem limite"
                />
                <small className="mudo">Teto a cada 24h no modo por tempo.</small>
              </label>
            </div>
          </>
        )}
        <div className="grade-campos grade-campos--estreita">
          <label className="campo">
            <span>Tolerância (min)</span>
            <input
              value={tolerancia}
              onChange={(e) => setTolerancia(e.target.value)}
              inputMode="numeric"
              required
            />
            <small className="mudo">Saindo até esse tempo, não paga nada.</small>
          </label>
          <label className="campo">
            <span>Diária (R$)</span>
            <input
              value={diaria}
              onChange={(e) => setDiaria(e.target.value)}
              inputMode="decimal"
              placeholder="Não oferece"
            />
            <small className="mudo">Preço do modo “Diária” escolhido na entrada.</small>
          </label>
        </div>
      </fieldset>

      <label className="opcao opcao--compacta">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Ativa nesta versão
      </label>

      <div className="previa-tarifa" aria-live="polite">
        <h3 className="pequeno">Prévia (modo por tempo)</h3>
        {problemas.length ? (
          <p className="pequeno erro">{problemas[0]}</p>
        ) : (
          <table className="tabela tabela--compacta">
            <tbody>
              {EXEMPLOS.map((m) => (
                <tr key={m}>
                  <td>{duracaoCurta(m)}</td>
                  <td className="numero">{formatarCentavos(calcularTarifa(regraDeDados(dados), m))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialogo>
  );
}
