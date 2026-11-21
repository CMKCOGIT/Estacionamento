import { useEffect, useState, type FormEvent } from 'react';
import { HORAS_APOS_SAIDA_MAX } from '@estacionamento/shared';
import { StatusSincronizacao } from '../components/StatusSincronizacao';
import { ErroDaApi } from '../services/api';
import { configuracoesApi } from '../services/configuracoes';

const OPCOES = [0, 1, 2, 6, 12, 24, 48, 72, 168];

const descrever = (h: number) =>
  h === 0
    ? 'O link para de funcionar no momento da saída.'
    : `O link continua funcionando por ${h === 168 ? '7 dias' : h === 1 ? '1 hora' : `${h} horas`} depois da saída (para o cliente conferir o valor pago).`;

/** Configurações do estacionamento (permissão config.gerenciar). */
export function Configuracoes() {
  const [horas, setHoras] = useState<number | null>(null);
  const [salva, setSalva] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    configuracoesApi.acessoCliente().then(
      (p) => {
        setHoras(p.horasAposSaida);
        setSalva(p.horasAposSaida);
      },
      (e: unknown) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar.'),
    );
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (horas === null) return;
    setEnviando(true);
    setErro(null);
    setOk(false);
    try {
      const p = await configuracoesApi.salvarAcessoCliente({ horasAposSaida: horas });
      setSalva(p.horasAposSaida);
      setOk(true);
    } catch (falha) {
      setErro(
        falha instanceof ErroDaApi && Array.isArray(falha.corpo.detalhes)
          ? falha.corpo.detalhes.map((d) => d.mensagem).join('. ')
          : falha instanceof Error
            ? falha.message
            : 'Não foi possível salvar.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao">
      <h1>Configurações</h1>
      <h2>Link do cliente (app Meu Ticket)</h2>
      <p>
        Cada entrada gera um link exclusivo e um QR Code. Com ele, o cliente acompanha o tempo e o valor do
        próprio ticket no celular, sem criar conta. Enquanto o veículo está no estacionamento, o link sempre
        funciona. Se o ticket for cancelado, o link para na hora.
      </p>
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {ok && (
        <p className="alerta alerta--ok" role="status">
          Política salva. Vale para as próximas saídas; tickets já encerrados mantêm o prazo que tinham.
        </p>
      )}
      {horas !== null && (
        <form onSubmit={salvar} noValidate>
          <label className="campo">
            <span>Depois da saída, o link funciona por</span>
            <select value={horas} onChange={(e) => setHoras(Number(e.target.value))}>
              {[...new Set([...OPCOES, horas])]
                .filter((h) => h <= HORAS_APOS_SAIDA_MAX)
                .sort((a, b) => a - b)
                .map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? 'Encerrar na saída' : h === 168 ? '7 dias' : h === 1 ? '1 hora' : `${h} horas`}
                  </option>
                ))}
            </select>
            <small>{descrever(horas)}</small>
          </label>
          <div className="acoes">
            <button type="submit" className="botao" disabled={enviando || horas === salva}>
              {enviando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
      <StatusSincronizacao />
    </section>
  );
}
