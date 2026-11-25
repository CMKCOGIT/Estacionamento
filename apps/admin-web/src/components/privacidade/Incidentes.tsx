import { useCallback, useState } from 'react';
import type { GravidadeIncidente, IncidenteSeguranca } from '@estacionamento/shared';
import { useCarregar } from '../../hooks/useCarregar';
import { ErroDaApi } from '../../services/api';
import { incidentesApi } from '../../services/privacidade';
import { formatarDataHora } from '../../services/rotulos';
import { Dialogo } from '../Dialogo';

const GRAVIDADE: Record<GravidadeIncidente, { texto: string; classe: string }> = {
  BAIXA: { texto: 'Baixa', classe: 'pilula--livre' },
  MEDIA: { texto: 'Média', classe: 'pilula--bloqueada' },
  ALTA: { texto: 'Alta', classe: 'pilula--ocupada' },
};
const mensagem = (e: unknown) =>
  e instanceof ErroDaApi && Array.isArray(e.corpo.detalhes) && e.corpo.detalhes.length
    ? (e.corpo.detalhes as { mensagem: string }[]).map((d) => d.mensagem).join('. ')
    : e instanceof Error
      ? e.message
      : 'Não foi possível concluir.';
/** "AAAA-MM-DDTHH:MM" local de agora (para o campo datetime-local). */
const agoraLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * Registro de incidentes de segurança com dados pessoais (LGPD art. 48).
 * Não pode ser apagado; encerrado não muda mais.
 */
export function Incidentes() {
  const carregar = useCallback(() => incidentesApi.listar(), []);
  const { dados, erro, recarregar } = useCarregar(carregar);
  const [novo, setNovo] = useState(false);
  const [acompanhar, setAcompanhar] = useState<IncidenteSeguranca | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <>
      <div className="cartao__topo">
        <h2>Incidentes de segurança</h2>
        <button type="button" className="botao" onClick={() => setNovo(true)}>
          Registrar incidente
        </button>
      </div>
      <p className="mudo">
        Vazamento, acesso indevido, perda de backup ou de computador com dados pessoais. Incidente que possa
        causar risco ou dano relevante aos titulares deve ser comunicado à ANPD e aos titulares em prazo
        razoável (art. 48). Os registros não podem ser apagados.
      </p>
      {ok && (
        <p className="alerta alerta--ok" role="status">
          {ok}
        </p>
      )}
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {!dados && !erro && <p className="mudo">Carregando…</p>}
      {dados && dados.itens.length === 0 && <p className="mudo">Nenhum incidente registrado.</p>}
      {dados && dados.itens.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Detectado</th>
                <th>O que aconteceu</th>
                <th>Gravidade</th>
                <th>Comunicação</th>
                <th>Situação</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((i) => (
                <tr key={i.id}>
                  <td className="sem-quebra">{formatarDataHora(i.detectadoEm)}</td>
                  <td>
                    {i.descricao}
                    <div className="mudo pequeno">
                      Dados: {i.dadosAfetados}
                      {i.titularesAfetados !== null && ` · ${i.titularesAfetados} titular(es)`}
                    </div>
                    {i.medidas && <div className="pequeno">Medidas: {i.medidas}</div>}
                  </td>
                  <td>
                    <span className={`pilula ${GRAVIDADE[i.gravidade].classe}`}>
                      {GRAVIDADE[i.gravidade].texto}
                    </span>
                  </td>
                  <td className="pequeno">
                    <div>ANPD: {i.comunicadoAnpdEm ? formatarDataHora(i.comunicadoAnpdEm) : '—'}</div>
                    <div>
                      Titulares: {i.comunicadoTitularesEm ? formatarDataHora(i.comunicadoTitularesEm) : '—'}
                    </div>
                  </td>
                  <td>
                    {i.status === 'ABERTO' ? 'Aberto' : `Encerrado ${formatarDataHora(i.encerradoEm)}`}
                    <div className="mudo pequeno">por {i.registradoPor ?? '—'}</div>
                  </td>
                  <td>
                    {i.status === 'ABERTO' && (
                      <button type="button" className="botao-texto" onClick={() => setAcompanhar(i)}>
                        Acompanhar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DialogoNovo
        aberto={novo}
        onFechar={() => setNovo(false)}
        onRegistrado={() => {
          setNovo(false);
          setOk('Incidente registrado.');
          recarregar();
        }}
      />
      <DialogoAcompanhar
        incidente={acompanhar}
        onFechar={() => setAcompanhar(null)}
        onSalvo={(t) => {
          setAcompanhar(null);
          setOk(t);
          recarregar();
        }}
      />
    </>
  );
}

function DialogoNovo({
  aberto,
  onFechar,
  onRegistrado,
}: {
  aberto: boolean;
  onFechar: () => void;
  onRegistrado: () => void;
}) {
  const [f, setF] = useState({
    detectadoEm: agoraLocal(),
    ocorridoEm: '',
    descricao: '',
    dadosAfetados: '',
    titulares: '',
    gravidade: 'MEDIA' as GravidadeIncidente,
    medidas: '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <Dialogo
      aberto={aberto}
      largo
      titulo="Registrar incidente de segurança"
      textoConfirmar={enviando ? 'Registrando…' : 'Registrar'}
      enviando={enviando}
      erro={erro}
      onFechar={() => !enviando && onFechar()}
      onConfirmar={() => {
        setEnviando(true);
        setErro(null);
        incidentesApi
          .registrar({
            detectadoEm: new Date(f.detectadoEm).toISOString(),
            ocorridoEm: f.ocorridoEm ? new Date(f.ocorridoEm).toISOString() : null,
            descricao: f.descricao,
            dadosAfetados: f.dadosAfetados,
            titularesAfetados: f.titulares ? Number(f.titulares) : null,
            gravidade: f.gravidade,
            medidas: f.medidas || null,
          })
          .then(onRegistrado)
          .catch((e: unknown) => setErro(mensagem(e)))
          .finally(() => setEnviando(false));
      }}
    >
      <div className="grade-config">
        <label className="campo">
          <span>Detectado em</span>
          <input
            type="datetime-local"
            value={f.detectadoEm}
            max={agoraLocal()}
            onChange={(e) => setF({ ...f, detectadoEm: e.target.value })}
          />
        </label>
        <label className="campo">
          <span>Ocorreu em (se souber)</span>
          <input
            type="datetime-local"
            value={f.ocorridoEm}
            onChange={(e) => setF({ ...f, ocorridoEm: e.target.value })}
          />
        </label>
        <label className="campo">
          <span>Gravidade</span>
          <select
            value={f.gravidade}
            onChange={(e) => setF({ ...f, gravidade: e.target.value as GravidadeIncidente })}
          >
            <option value="BAIXA">Baixa</option>
            <option value="MEDIA">Média</option>
            <option value="ALTA">Alta</option>
          </select>
        </label>
        <label className="campo">
          <span>Titulares afetados (aprox.)</span>
          <input
            type="number"
            min={0}
            value={f.titulares}
            onChange={(e) => setF({ ...f, titulares: e.target.value })}
          />
        </label>
      </div>
      <label className="campo">
        <span>O que aconteceu</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={f.descricao}
          onChange={(e) => setF({ ...f, descricao: e.target.value })}
        />
      </label>
      <label className="campo">
        <span>Dados pessoais afetados</span>
        <input
          maxLength={500}
          value={f.dadosAfetados}
          placeholder="Ex.: placas e horários de entrada"
          onChange={(e) => setF({ ...f, dadosAfetados: e.target.value })}
        />
      </label>
      <label className="campo">
        <span>Medidas já tomadas</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={f.medidas}
          onChange={(e) => setF({ ...f, medidas: e.target.value })}
        />
      </label>
    </Dialogo>
  );
}

function DialogoAcompanhar({
  incidente,
  onFechar,
  onSalvo,
}: {
  incidente: IncidenteSeguranca | null;
  onFechar: () => void;
  onSalvo: (texto: string) => void;
}) {
  const [medidas, setMedidas] = useState('');
  const [anpd, setAnpd] = useState(false);
  const [titulares, setTitulares] = useState(false);
  const [encerrar, setEncerrar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [anterior, setAnterior] = useState(incidente);
  if (anterior !== incidente) {
    setAnterior(incidente);
    setMedidas(incidente?.medidas ?? '');
    setAnpd(false);
    setTitulares(false);
    setEncerrar(false);
    setErro(null);
  }
  return (
    <Dialogo
      aberto={!!incidente}
      titulo="Acompanhar incidente"
      textoConfirmar={enviando ? 'Salvando…' : encerrar ? 'Salvar e encerrar' : 'Salvar'}
      enviando={enviando}
      erro={erro}
      onFechar={() => !enviando && onFechar()}
      onConfirmar={() => {
        if (!incidente) return;
        setEnviando(true);
        setErro(null);
        incidentesApi
          .atualizar(incidente.id, {
            medidas: medidas || null,
            comunicadoAnpd: anpd || undefined,
            comunicadoTitulares: titulares || undefined,
            encerrar: encerrar || undefined,
          })
          .then(() => onSalvo(encerrar ? 'Incidente encerrado.' : 'Incidente atualizado.'))
          .catch((e: unknown) => setErro(mensagem(e)))
          .finally(() => setEnviando(false));
      }}
    >
      {incidente && (
        <>
          <p>{incidente.descricao}</p>
          <label className="campo">
            <span>Medidas tomadas</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={medidas}
              onChange={(e) => setMedidas(e.target.value)}
            />
          </label>
          {!incidente.comunicadoAnpdEm && (
            <label className="opcao-check">
              <input type="checkbox" checked={anpd} onChange={(e) => setAnpd(e.target.checked)} />
              <span>
                <strong>Comunicado à ANPD agora</strong>
                <small>Registra a data e a hora de hoje.</small>
              </span>
            </label>
          )}
          {!incidente.comunicadoTitularesEm && (
            <label className="opcao-check">
              <input type="checkbox" checked={titulares} onChange={(e) => setTitulares(e.target.checked)} />
              <span>
                <strong>Titulares comunicados agora</strong>
                <small>Registra a data e a hora de hoje.</small>
              </span>
            </label>
          )}
          <label className="opcao-check">
            <input type="checkbox" checked={encerrar} onChange={(e) => setEncerrar(e.target.checked)} />
            <span>
              <strong>Encerrar o incidente</strong>
              <small>Depois de encerrado, não pode mais ser alterado.</small>
            </span>
          </label>
        </>
      )}
    </Dialogo>
  );
}

/** Quais dados pessoais o sistema guarda, para quê, quem acessa e por quanto tempo. */
export function Inventario() {
  const carregar = useCallback(() => incidentesApi.inventario(), []);
  const { dados, erro } = useCarregar(carregar);
  return (
    <>
      <h2>Dados pessoais armazenados</h2>
      <p className="mudo">
        Quantidades de hoje, lidas do banco. O app do cliente nunca recebe nome, CPF, operador ou forma de
        pagamento: só a placa mascarada e os valores do ticket.
      </p>
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {!dados && !erro && <p className="mudo">Carregando…</p>}
      {dados && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Dados</th>
                <th>Para quê</th>
                <th>Quem acessa</th>
                <th>Por quanto tempo</th>
                <th className="numero">Registros</th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((i) => (
                <tr key={i.categoria}>
                  <td>
                    <strong>{i.categoria}</strong>
                  </td>
                  <td>{i.dados}</td>
                  <td>{i.finalidade}</td>
                  <td>{i.quemAcessa}</td>
                  <td>{i.retencao}</td>
                  <td className="numero">{i.quantidade.toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Política de privacidade</h2>
      <p>
        A política para os clientes é publicada no app do cliente (página “Privacidade”) e mostra o
        encarregado (aba “Retenção e encarregado”), os dados tratados e como pedir acesso, correção ou
        exclusão.
      </p>
      {dados?.politicaUrl ? (
        <p>
          <a href={dados.politicaUrl} target="_blank" rel="noreferrer">
            Abrir a política publicada
          </a>
        </p>
      ) : (
        <p className="mudo">O app do cliente ainda não foi publicado (Conectar-Nuvem.cmd).</p>
      )}
    </>
  );
}
