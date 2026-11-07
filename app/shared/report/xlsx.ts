/** Small dependency-free XLSX (OOXML SpreadsheetML) writer. Strings are stored as shared strings (inert: never formulas). */
import { zipStored } from './zip';

export type StyleName = 'default' | 'header' | 'int' | 'dec' | 'pct' | 'datetime' | 'date' | 'title' | 'bold' | 'wrap' | 'muted';
export type CellValue = string | number | boolean | Date | null | undefined;
export interface StyledCell { v: CellValue; s?: StyleName }
export type CellInput = CellValue | StyledCell;

export interface SheetInput {
  name: string;
  rows: CellInput[][];
  /** column widths in characters */
  widths?: number[];
  /** 0-based index of the header row: styled as header, panes frozen below it, autofilter applied */
  headerRow?: number;
  autoFilter?: boolean;
}
export interface WorkbookInput { sheets: SheetInput[]; title?: string; creator?: string; created?: Date }

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;
const MAX_CELL_CHARS = 32767;

/** XML 1.0 forbids most C0 controls and lone surrogates; strip them. Keeps \t \n \r. */
export function cleanXmlText(s: string): string {
  let out = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
  out = out.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  return out;
}

export function escapeXml(s: string): string {
  return cleanXmlText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
}

/** Cell text: strips control characters (also leading whitespace controls) and caps the length. */
export function cleanCellString(s: string): string {
  let t = cleanXmlText(s).replace(/^[\t\r\n]+/, '');
  if (t.length > MAX_CELL_CHARS) t = t.slice(0, MAX_CELL_CHARS);
  return t;
}

export function sanitizeSheetName(name: string, used: Set<string> = new Set()): string {
  let n = cleanXmlText(name).replace(/[\\/?*[\]:]/g, '-').replace(/^'+|'+$/g, '').trim();
  if (!n) n = 'Sheet';
  if (n.toLowerCase() === 'history') n += '_';
  n = n.slice(0, 31);
  let cand = n, i = 2;
  while (used.has(cand.toLowerCase())) {
    const suf = ` (${i++})`;
    cand = n.slice(0, 31 - suf.length) + suf;
  }
  used.add(cand.toLowerCase());
  return cand;
}

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel serial (1900 system) of a Date interpreted in LOCAL time so the sheet shows the wall-clock time. */
export function excelSerial(d: Date | number): number {
  const date = typeof d === 'number' ? new Date(d) : d;
  const localMs = date.getTime() - date.getTimezoneOffset() * 60000;
  return localMs / 86400000 + 25569;
}

const STYLE_INDEX: Record<StyleName, number> = { default: 0, header: 1, int: 2, dec: 3, pct: 4, datetime: 5, date: 6, title: 7, bold: 8, wrap: 9, muted: 10 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF128C7E"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF657084"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF128C7E"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function buildXlsx(wb: WorkbookInput): Uint8Array {
  if (!wb.sheets.length) throw new Error('Workbook membutuhkan minimal satu sheet');
  const sst = new Map<string, number>();
  let sstRefs = 0;
  const sstList: string[] = [];
  const sstIndex = (s: string) => {
    sstRefs++;
    let i = sst.get(s);
    if (i == null) { i = sstList.length; sstList.push(s); sst.set(s, i); }
    return i;
  };

  const used = new Set<string>();
  const names = wb.sheets.map((s) => sanitizeSheetName(s.name, used));
  const sheetXml: string[] = [];
  const filterNames: string[] = [];

  wb.sheets.forEach((sh, si) => {
    const rows = sh.rows.slice(0, MAX_ROWS);
    let maxCol = 0;
    const parts: string[] = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r].slice(0, MAX_COLS);
      if (row.length > maxCol) maxCol = row.length;
      const isHeader = sh.headerRow === r;
      const cells: string[] = [];
      for (let c = 0; c < row.length; c++) {
        const raw = row[c];
        let v: CellValue, style: StyleName | undefined;
        if (raw !== null && typeof raw === 'object' && !(raw instanceof Date)) { v = raw.v; style = raw.s; } else v = raw;
        if (isHeader && !style) style = 'header';
        if (v instanceof Date) { v = Number.isFinite(v.getTime()) ? excelSerial(v) : null; if (!style) style = 'datetime'; }
        const ref = colName(c) + (r + 1);
        const sAttr = style && style !== 'default' ? ` s="${STYLE_INDEX[style]}"` : '';
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) { if (sAttr) cells.push(`<c r="${ref}"${sAttr}/>`); continue; }
          cells.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
        } else if (typeof v === 'boolean') {
          cells.push(`<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`);
        } else if (typeof v === 'string') {
          const t = cleanCellString(v);
          if (t === '') { if (sAttr) cells.push(`<c r="${ref}"${sAttr}/>`); continue; }
          cells.push(`<c r="${ref}"${sAttr} t="s"><v>${sstIndex(t)}</v></c>`);
        } else if (sAttr) cells.push(`<c r="${ref}"${sAttr}/>`);
      }
      const ht = isHeader ? ' ht="22" customHeight="1"' : '';
      parts.push(cells.length || ht ? `<row r="${r + 1}"${ht}>${cells.join('')}</row>` : '');
    }
    const hr = sh.headerRow;
    const frozen = hr != null && hr >= 0 && hr < rows.length;
    let x = `${XML}<worksheet xmlns="${NS}" xmlns:r="${NS_R}"><sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}>`;
    if (frozen) x += `<pane ySplit="${hr! + 1}" topLeftCell="A${hr! + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${hr! + 2}" sqref="A${hr! + 2}"/>`;
    x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    const widths = sh.widths ?? [];
    if (widths.length) {
      x += '<cols>' + widths.slice(0, MAX_COLS).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(255, Math.max(2, w))}" customWidth="1"/>`).join('') + '</cols>';
    }
    x += `<sheetData>${parts.join('')}</sheetData>`;
    if (frozen && sh.autoFilter !== false && maxCol > 0 && rows.length > hr! + 1) {
      const ref = `A${hr! + 1}:${colName(maxCol - 1)}${rows.length}`;
      x += `<autoFilter ref="${ref}"/>`;
      const q = names[si].replace(/'/g, "''");
      filterNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${si}" hidden="1">'${escapeXml(q)}'!$A$${hr! + 1}:$${colName(maxCol - 1)}$${rows.length}</definedName>`);
    }
    x += '</worksheet>';
    sheetXml.push(x);
  });

  const enc = new TextEncoder();
  const e = (s: string) => enc.encode(s);
  const n = wb.sheets.length;
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + sheetXml.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const rootRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  const workbook = `${XML}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>`
    + names.map((nm, i) => `<sheet name="${escapeXml(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
    + (filterNames.length ? `<definedNames>${filterNames.join('')}</definedNames>` : '') + '</workbook>';
  const wbRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const sstXml = `${XML}<sst xmlns="${NS}" count="${sstRefs}" uniqueCount="${sstList.length}">`
    + sstList.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('') + '</sst>';
  const created = (wb.created ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${escapeXml(wb.title ?? 'Laporan')}</dc:title><dc:creator>${escapeXml(wb.creator ?? 'WhatsApp Web Toolkit by Irvandoda')}</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`;
  const app = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WhatsApp Web Toolkit by Irvandoda</Application></Properties>`;

  const date = wb.created ?? new Date();
  return zipStored([
    { name: '[Content_Types].xml', data: e(ct) },
    { name: '_rels/.rels', data: e(rootRels) },
    { name: 'docProps/core.xml', data: e(core) },
    { name: 'docProps/app.xml', data: e(app) },
    { name: 'xl/workbook.xml', data: e(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: e(wbRels) },
    { name: 'xl/styles.xml', data: e(STYLES_XML) },
    { name: 'xl/sharedStrings.xml', data: e(sstXml) },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: e(x) })),
  ], date);
}
