import { useEffect, useRef } from 'react';
import type { CatalogoPermissoes } from '@estacionamento/shared';

interface Props {
  catalogo: CatalogoPermissoes;
  valor: string[];
  onChange: (permissoes: string[]) => void;
  /** Permissões que o usuário logado pode conceder (as demais ficam travadas). */
  podeConceder: (codigo: string) => boolean;
  desabilitado?: boolean;
}

/** Checkbox com estado "parcial" (alguns itens do módulo marcados). */
function CaixaModulo({
  marcado,
  parcial,
  ...props
}: { marcado: boolean; parcial: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = parcial;
  }, [parcial]);
  return <input ref={ref} type="checkbox" checked={marcado} {...props} />;
}

/** Escolha das funcionalidades que um funcionário pode acessar, por módulo. */
export function SeletorPermissoes({ catalogo, valor, onChange, podeConceder, desabilitado }: Props) {
  const marcadas = new Set(valor);
  const alternar = (codigos: string[], ligar: boolean) => {
    const novo = new Set(marcadas);
    for (const c of codigos) {
      if (!podeConceder(c)) continue;
      if (ligar) novo.add(c);
      else novo.delete(c);
    }
    onChange([...novo].sort());
  };

  return (
    <div className="permissoes">
      <div className="permissoes__modelos">
        <span className="mudo">Preencher com um modelo:</span>
        {catalogo.modelos.map((m) => (
          <button
            key={m.codigo}
            type="button"
            className="botao botao--secundario botao--pequeno"
            disabled={desabilitado}
            title={m.descricao ?? undefined}
            onClick={() => onChange(m.permissoes.filter(podeConceder).sort())}
          >
            {m.nome}
          </button>
        ))}
        <button type="button" className="botao-texto" disabled={desabilitado} onClick={() => onChange([])}>
          Limpar tudo
        </button>
      </div>

      {catalogo.modulos.map((modulo) => {
        const codigos = modulo.permissoes.map((p) => p.codigo);
        const qtd = codigos.filter((c) => marcadas.has(c)).length;
        return (
          <fieldset key={modulo.codigo} className="permissoes__modulo" disabled={desabilitado}>
            <legend>
              <label className="permissoes__titulo">
                <CaixaModulo
                  marcado={qtd === codigos.length}
                  parcial={qtd > 0 && qtd < codigos.length}
                  onChange={(e) => alternar(codigos, e.target.checked)}
                  aria-label={`Todas as permissões de ${modulo.nome}`}
                />
                {modulo.nome}
                <span className="mudo">
                  {qtd}/{codigos.length}
                </span>
              </label>
            </legend>
            {modulo.permissoes.map((p) => {
              const permitida = podeConceder(p.codigo);
              return (
                <label
                  key={p.codigo}
                  className={`permissoes__item${permitida ? '' : ' permissoes__item--travada'}`}
                  title={permitida ? p.codigo : 'Você não possui esta permissão, então não pode concedê-la'}
                >
                  <input
                    type="checkbox"
                    checked={marcadas.has(p.codigo)}
                    disabled={!permitida}
                    onChange={(e) => alternar([p.codigo], e.target.checked)}
                  />
                  {p.descricao}
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
