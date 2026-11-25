import { IconeDownload, IconeRelatorio } from './Icones';
import { baixarExcel, imprimirPdf, type AbaPlanilha } from './exportar';

/** "Excel" e "PDF" lado a lado. `abas` é chamado no clique (dados do momento). */
export function BotoesExportar({
  nome,
  abas,
  desabilitado,
}: {
  nome: string;
  abas: () => AbaPlanilha[];
  desabilitado?: boolean;
}) {
  return (
    <div className="botoes-exportar nao-imprimir">
      <button
        type="button"
        className="botao botao--secundario"
        disabled={desabilitado}
        onClick={() => baixarExcel(nome, abas())}
      >
        <IconeDownload tamanho={16} /> Excel
      </button>
      <button
        type="button"
        className="botao botao--secundario"
        disabled={desabilitado}
        onClick={() => imprimirPdf(nome)}
      >
        <IconeRelatorio tamanho={16} /> PDF
      </button>
    </div>
  );
}
