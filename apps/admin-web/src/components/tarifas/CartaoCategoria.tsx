import type { RegraCadastrada } from '@estacionamento/shared';
import { linhasDaRegra, quandoVale } from './util';

interface Acoes {
  onEditar: (r: RegraCadastrada) => void;
  onAlternar: (r: RegraCadastrada) => void;
  onRemover: (r: RegraCadastrada) => void;
  onNovaEspecial: (categoriaId: string) => void;
  onDefinirPadrao: (categoriaId: string) => void;
}

interface Props {
  categoriaId: string;
  categoria: string;
  regras: RegraCadastrada[];
  /** Só no rascunho: botões de cadastrar, editar e desativar. */
  acoes?: Acoes;
}

function Regra({ r, acoes }: { r: RegraCadastrada; acoes?: Acoes }) {
  return (
    <article className={`regra-tarifa${r.ativo ? '' : ' regra-tarifa--inativa'}`}>
      <header className="regra-tarifa__topo">
        <div>
          <h4>{r.tipo === 'PADRAO' ? 'Tarifa padrão' : r.nome}</h4>
          <p className="pequeno mudo">{quandoVale(r)}</p>
        </div>
        {!r.ativo && <span className="etiqueta etiqueta--inativo">Desativada</span>}
        {r.tipo === 'ESPECIAL' && r.ativo && <span className="etiqueta etiqueta--sem_acesso">Especial</span>}
      </header>
      <dl className="lista-dados lista-dados--compacta">
        {linhasDaRegra(r).map(([rotulo, valor]) => (
          <div key={rotulo} className="lista-dados__linha">
            <dt>{rotulo}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      {acoes && (
        <div className="acoes acoes--quebrar">
          <button
            type="button"
            className="botao botao--secundario botao--pequeno"
            onClick={() => acoes.onEditar(r)}
          >
            Editar
          </button>
          <button type="button" className="botao-texto" onClick={() => acoes.onAlternar(r)}>
            {r.ativo ? 'Desativar' : 'Reativar'}
          </button>
          {r.tipo === 'ESPECIAL' && (
            <button
              type="button"
              className="botao-texto botao-texto--perigo"
              onClick={() => acoes.onRemover(r)}
            >
              Remover desta versão
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function CartaoCategoria({ categoriaId, categoria, regras, acoes }: Props) {
  const padrao = regras.find((r) => r.tipo === 'PADRAO');
  const especiais = regras.filter((r) => r.tipo === 'ESPECIAL');
  return (
    <section className="cartao categoria-tarifa" aria-label={`Tarifas de ${categoria}`}>
      <h3>{categoria}</h3>
      {padrao ? (
        <Regra r={padrao} acoes={acoes} />
      ) : (
        <p className="alerta alerta--erro">
          Sem tarifa padrão: entradas de {categoria} são recusadas.{' '}
          {acoes && (
            <button type="button" className="botao-texto" onClick={() => acoes.onDefinirPadrao(categoriaId)}>
              Definir preço
            </button>
          )}
        </p>
      )}
      {especiais.map((r) => (
        <Regra key={r.id} r={r} acoes={acoes} />
      ))}
      {acoes && (
        <button type="button" className="botao-texto" onClick={() => acoes.onNovaEspecial(categoriaId)}>
          + Tarifa especial para {categoria}
        </button>
      )}
    </section>
  );
}
