import { useEffect, useState } from 'react';
import { api } from '../api';
import { lerSite, lerTickets } from '../armazenamento';
import { SITE_PADRAO } from '../config';

/** Contato do encarregado de dados (LGPD art. 41), vindo do estacionamento. */
function useContatoPrivacidade() {
  const ticket = lerTickets()[0]?.ultimo;
  const [contato, setContato] = useState<string | null>(ticket?.estacionamento.contatoPrivacidade ?? null);
  const slug = ticket?.estacionamento.slug ?? lerSite() ?? SITE_PADRAO;
  useEffect(() => {
    api.disponibilidade(slug).then(
      (d) => setContato(d.estacionamento.contatoPrivacidade ?? null),
      () => undefined, // sem internet: fica o que estava guardado
    );
  }, [slug]);
  return contato;
}

export function Privacidade() {
  const guardados = lerTickets().length;
  const contato = useContatoPrivacidade();
  return (
    <section className="cartao texto">
      <h1>Privacidade</h1>
      <p>
        Este app mostra só <b>o seu ticket</b>: placa, horário de entrada e saída, vaga e valor. Não pedimos
        nome, CPF, telefone nem login.
      </p>
      <h2>Como o seu ticket fica protegido</h2>
      <ul>
        <li>
          O link do ticket tem um código secreto, impossível de adivinhar. Só quem tem o link vê o ticket — e
          cada link mostra apenas um ticket.
        </li>
        <li>O código não é enviado ao abrir a página e não fica gravado nos registros do servidor.</li>
        <li>
          Depois da saída, o link funciona só pelo prazo definido pelo estacionamento. Se você perdeu ou
          compartilhou o link, peça um novo no caixa: o antigo para de funcionar na hora.
        </li>
        <li>Toda a comunicação é criptografada (HTTPS).</li>
      </ul>
      <h2>Para que usamos os seus dados</h2>
      <ul>
        <li>
          Controlar a entrada, a permanência e a saída do veículo e cobrar a estadia (execução do contrato).
        </li>
        <li>Guardar os registros dos pagamentos, como a lei exige (obrigação legal).</li>
        <li>
          Depois de um tempo sem visitas, a placa é anonimizada. Os valores pagos ficam guardados sem a placa.
        </li>
      </ul>
      <h2>Seus direitos (LGPD)</h2>
      <p>
        Você pode pedir a confirmação e uma cópia dos seus dados, a correção, a anonimização ou eliminação, a
        portabilidade e a informação de com quem eles são compartilhados. Peça no caixa ou pelo contato
        abaixo: a resposta sai em até 15 dias.
      </p>
      <p>
        <b>Encarregado de dados:</b> {contato ?? 'fale com o caixa do estacionamento.'}
      </p>
      <h2>O que fica neste celular</h2>
      <p>
        Os tickets que você abriu ({guardados}) ficam guardados aqui para você reabrir sem ler o QR Code de
        novo. Use “Esquecer este ticket” para apagar. Quando o acesso termina, a placa sai do celular sozinha.
        Nada é compartilhado com outros apps.
      </p>
      <p className="mudo pequeno">
        Este app não dá acesso a nenhuma função do estacionamento: só consulta, sem alterar nada.
      </p>
    </section>
  );
}
