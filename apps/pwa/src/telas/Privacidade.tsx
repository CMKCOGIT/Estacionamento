import { lerTickets } from '../armazenamento';

export function Privacidade() {
  const guardados = lerTickets().length;
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
          O link deixa de funcionar 24 horas depois da saída. Se você perdeu ou compartilhou o link, peça um
          novo no caixa: o antigo para de funcionar na hora.
        </li>
        <li>Toda a comunicação é criptografada (HTTPS).</li>
      </ul>
      <h2>O que fica neste celular</h2>
      <p>
        Os tickets que você abriu ({guardados}) ficam guardados aqui para você reabrir sem ler o QR Code de
        novo. Use “Esquecer este ticket” para apagar. Nada é compartilhado com outros apps.
      </p>
      <p className="mudo pequeno">
        Este app não dá acesso a nenhuma função do estacionamento: só consulta, sem alterar nada.
      </p>
    </section>
  );
}
