import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { DisponibilidadePublica, TarifasPublicas } from '@estacionamento/shared';
import { api, ErroApi } from '../api';
import { gravarSite, lerSite, lerTickets } from '../armazenamento';
import { SITE_PADRAO } from '../config';
import { haQuanto } from '../formato';

/** Vagas livres agora e a tabela de preços do estacionamento. */
export function Inicio() {
  const { slug: daRota } = useParams();
  const slug = daRota ?? lerTickets()[0]?.ultimo?.estacionamento.slug ?? lerSite() ?? SITE_PADRAO;
  const [disp, setDisp] = useState<DisponibilidadePublica | null>(null);
  const [tarifas, setTarifas] = useState<TarifasPublicas | null>(null);
  const [falha, setFalha] = useState<ErroApi | null>(null);
  const temTicket = lerTickets().length > 0;

  const buscar = useCallback(
    () =>
      Promise.all([api.disponibilidade(slug), api.tarifas(slug)]).then(
        ([d, t]) => {
          setDisp(d);
          setTarifas(t);
          setFalha(null);
          gravarSite(slug);
        },
        (e: unknown) =>
          setFalha(e instanceof ErroApi ? e : new ErroApi('INDISPONIVEL', 'Não foi possível carregar.')),
      ),
    [slug],
  );
  useEffect(() => {
    void buscar();
    const t = setInterval(() => document.visibilityState === 'visible' && void buscar(), 30_000);
    window.addEventListener('online', buscar);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', buscar);
    };
  }, [buscar]);

  const categorias = [...new Set(tarifas?.tarifas.map((t) => t.categoria) ?? [])];
  return (
    <>
      {temTicket && (
        <Link to="/ticket" className="atalho-ticket">
          <span>Ver o meu ticket</span>
          <span aria-hidden="true">›</span>
        </Link>
      )}
      {falha && !disp && (
        <section className="cartao">
          <p className="alerta">
            {falha.tipo === 'NAO_ENCONTRADO'
              ? 'Estacionamento não encontrado.'
              : `${falha.message} Tente de novo em instantes.`}
          </p>
        </section>
      )}
      {disp && (
        <section className="cartao vagas" aria-labelledby="titulo-vagas">
          <h1 id="titulo-vagas">{disp.estacionamento.nome}</h1>
          {disp.estacionamento.endereco && <p className="mudo">{disp.estacionamento.endereco}</p>}
          <div className="vagas__total">
            <strong>{disp.vagasLivres}</strong>
            <span>
              vaga{disp.vagasLivres === 1 ? '' : 's'} livre{disp.vagasLivres === 1 ? '' : 's'} agora
              <small>de {disp.totalVagas}</small>
            </span>
          </div>
          <ul className="vagas__categorias">
            {disp.categorias.map((c) => (
              <li key={c.categoria}>
                <span className="vagas__nome">{c.categoria}</span>
                <span className="medidor" role="img" aria-label={`${c.livres} de ${c.total} livres`}>
                  <span style={{ width: `${c.total ? (c.livres / c.total) * 100 : 0}%` }} />
                </span>
                <span className="vagas__numero">
                  {c.livres === 0 ? 'Lotado' : `${c.livres} livre${c.livres === 1 ? '' : 's'}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="atualizacao">
            {disp.atualizadoEm ? `Atualizado ${haQuanto(disp.atualizadoEm)}` : 'Sem atualização recente'}
            {falha && ' · sem conexão agora'}
          </p>
        </section>
      )}
      {tarifas && tarifas.tarifas.length > 0 && (
        <section className="cartao" aria-labelledby="titulo-precos">
          <h2 id="titulo-precos">Preços</h2>
          {categorias.map((cat) => (
            <div key={cat} className="precos">
              <h3>{cat}</h3>
              {tarifas.tarifas
                .filter((t) => t.categoria === cat)
                .map((t) => (
                  <div key={t.nome} className={`preco${t.especial ? ' preco--especial' : ''}`}>
                    {t.especial && (
                      <p className="preco__nome">
                        {t.nome}
                        {t.condicao && <span> · {t.condicao}</span>}
                      </p>
                    )}
                    <ul>
                      {t.linhas.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          ))}
          <p className="mudo pequeno">Pagamento no caixa, na saída: dinheiro, Pix ou cartão.</p>
        </section>
      )}
      {!temTicket && (
        <section className="cartao dica-ticket">
          <h2>Já estacionou?</h2>
          <p>Leia o QR Code mostrado no caixa para acompanhar o tempo e o valor do seu ticket por aqui.</p>
        </section>
      )}
    </>
  );
}
