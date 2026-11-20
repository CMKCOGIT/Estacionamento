import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './componentes/Layout';
import { AbrirLink } from './telas/AbrirLink';
import { Inicio } from './telas/Inicio';
import { MeusTickets } from './telas/MeusTickets';
import { Privacidade } from './telas/Privacidade';

/** Rotas do app do cliente. Não há nenhuma tela administrativa. */
export function App({ novaVersao }: { novaVersao: (() => void) | null }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout novaVersao={novaVersao} />}>
          <Route index element={<Inicio />} />
          <Route path="s/:slug" element={<Inicio />} />
          <Route path="t" element={<AbrirLink />} />
          <Route path="ticket" element={<MeusTickets />} />
          <Route path="privacidade" element={<Privacidade />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
