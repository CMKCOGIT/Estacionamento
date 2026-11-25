import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { nomeDoNivel, type FuncionarioResumo } from '@estacionamento/shared';
import { useCarregar } from '../hooks/useCarregar';
import { ROTULOS_SITUACAO, formatarDataHora } from '../services/rotulos';
import { usuariosApi } from '../services/usuarios';

export function Usuarios() {
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState('ativos');
  const [nivel, setNivel] = useState('');
  const [filtro, setFiltro] = useState({ busca: '', situacao: 'ativos', nivel: '' });

  const lista = useCarregar(useCallback(() => usuariosApi.listar(filtro), [filtro]));
  const aplicar = (mudanca: Partial<typeof filtro>) => setFiltro((f) => ({ ...f, ...mudanca }));

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Funcionários e usuários</h1>
          <p className="mudo">Cadastro de funcionários, acesso ao sistema e permissões.</p>
        </div>
        <Link to="/usuarios/novo" className="botao">
          Novo funcionário
        </Link>
      </header>

      <form
        className="filtros cartao"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ busca: busca.trim() });
        }}
      >
        <label className="campo campo--crescer">
          <span>Buscar</span>
          <input
            type="search"
            placeholder="Nome, login, cargo ou CPF"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <label className="campo">
          <span>Situação</span>
          <select
            value={situacao}
            onChange={(e) => {
              setSituacao(e.target.value);
              aplicar({ situacao: e.target.value });
            }}
          >
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <label className="campo">
          <span>Nível</span>
          <select
            value={nivel}
            onChange={(e) => {
              setNivel(e.target.value);
              aplicar({ nivel: e.target.value });
            }}
          >
            <option value="">Todos</option>
            <option value="admin">Administrador</option>
            <option value="gerente">Gerente</option>
            <option value="funcionario">Operador</option>
            <option value="sem_acesso">Sem acesso ao sistema</option>
          </select>
        </label>
        <button type="submit" className="botao botao--secundario">
          Buscar
        </button>
      </form>

      <section className="cartao">
        {lista.carregando && <p className="mudo">Carregando…</p>}
        {lista.erro && <p className="alerta alerta--erro">{lista.erro.message}</p>}
        {lista.dados && lista.dados.itens.length === 0 && (
          <p className="mudo">Nenhum funcionário encontrado com esses filtros.</p>
        )}
        {lista.dados && lista.dados.itens.length > 0 && (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cargo</th>
                  <th>Login</th>
                  <th>Nível</th>
                  <th>Situação</th>
                  <th>Último acesso</th>
                  <th>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {lista.dados.itens.map((f) => (
                  <Linha key={f.id} f={f} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Linha({ f }: { f: FuncionarioResumo }) {
  return (
    <tr>
      <td>
        <Link to={`/usuarios/${f.id}`} className="link-forte">
          {f.nome}
        </Link>
      </td>
      <td>{f.cargo ?? '—'}</td>
      <td>{f.acesso ? <code>{f.acesso.login}</code> : '—'}</td>
      <td>{f.acesso ? nomeDoNivel(f.acesso.nivel) : '—'}</td>
      <td>
        <span className={`etiqueta etiqueta--${f.situacao.toLowerCase()}`}>
          {ROTULOS_SITUACAO[f.situacao]}
        </span>
      </td>
      <td>{formatarDataHora(f.acesso?.ultimoLoginEm ?? null)}</td>
      <td className="sem-quebra">
        {f.cadastradoEm ? new Date(f.cadastradoEm).toLocaleDateString('pt-BR') : '—'}
      </td>
    </tr>
  );
}
