/**
 * Exportação de relatórios:
 *  - Excel: arquivo .xlsx de verdade (Office Open XML), montado aqui mesmo,
 *    sem biblioteca: texto, número e data viram células do tipo certo;
 *  - PDF: a impressão do navegador ("Salvar como PDF"), com uma folha de
 *    estilo de impressão que esconde o menu e os botões.
 */
export type Celula = string | number | null;
export interface AbaPlanilha {
  nome: string;
  cabecalho: string[];
  linhas: Celula[][];
}

// ---------------------------------------------------------------- ZIP (store)
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP sem compressão (método "store"): o .xlsx é um ZIP de arquivos XML. */
export function zipar(arquivos: { nome: string; conteudo: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome);
    const dados = enc.encode(a.conteudo);
    const crc = crc32(dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    partes.push(new Uint8Array(local.buffer), nome, dados);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, dados.length, true);
    cd.setUint32(24, dados.length, true);
    cd.setUint16(28, nome.length, true);
    cd.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(cd.buffer), nome);
    deslocamento += 30 + nome.length + dados.length;
  }
  const tamanhoCentral = central.reduce((t, p) => t + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const saida = new Uint8Array(todas.reduce((t, p) => t + p.length, 0));
  let i = 0;
  for (const p of todas) {
    saida.set(p, i);
    i += p.length;
  }
  return saida;
}

// ---------------------------------------------------------------- XLSX
const xml = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // caracteres de controle não são válidos em XML
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function coluna(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function planilha(aba: AbaPlanilha): string {
  const linhas = [aba.cabecalho, ...aba.linhas].map((l, r) => {
    const celulas = l
      .map((v, c) => {
        const ref = `${coluna(c)}${r + 1}`;
        if (v === null || v === '') return '';
        if (typeof v === 'number' && Number.isFinite(v))
          return `<c r="${ref}"${r === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
      })
      .join('');
    return `<row r="${r + 1}">${celulas}</row>`;
  });
  const larguras = aba.cabecalho
    .map((h, c) => {
      const maior = Math.max(h.length, ...aba.linhas.slice(0, 200).map((l) => String(l[c] ?? '').length));
      return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(8, maior + 2))}" customWidth="1"/>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `${larguras ? `<cols>${larguras}</cols>` : ''}<sheetData>${linhas.join('')}</sheetData></worksheet>`
  );
}

/** Monta o .xlsx (bytes). Exportado para teste. */
export function montarXlsx(abas: AbaPlanilha[]): Uint8Array {
  const nomes = abas.map((a, i) =>
    xml(a.nome.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Planilha ${i + 1}`),
  );
  return zipar([
    {
      nome: '[Content_Types].xml',
      conteudo:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        abas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    },
    {
      nome: '_rels/.rels',
      conteudo:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      nome: 'xl/workbook.xml',
      conteudo:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        nomes.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      conteudo:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        abas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      nome: 'xl/styles.xml',
      conteudo:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>',
    },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: planilha(a) })),
  ]);
}

const nomeDeArquivo = (nome: string) =>
  nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-');

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Baixa uma planilha Excel (.xlsx). Valores em reais vão como número (ex.: 18.5). */
export function baixarExcel(nome: string, abas: AbaPlanilha[]) {
  const bytes = montarXlsx(abas);
  baixar(
    new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${nomeDeArquivo(nome)}.xlsx`,
  );
}

/** Centavos → reais como número (para a planilha somar). */
export const reais = (centavos: number | null | undefined) =>
  centavos === null || centavos === undefined ? null : Math.round(centavos) / 100;

/**
 * PDF pela impressão do navegador ("Salvar como PDF"). O título vira o nome
 * sugerido do arquivo; o menu, os filtros e os botões não saem no papel.
 */
export function imprimirPdf(titulo: string) {
  const anterior = document.title;
  document.title = nomeDeArquivo(titulo);
  document.body.classList.add('imprimindo');
  const fim = () => {
    document.title = anterior;
    document.body.classList.remove('imprimindo');
    window.removeEventListener('afterprint', fim);
  };
  window.addEventListener('afterprint', fim);
  window.print();
  setTimeout(fim, 1000);
}
