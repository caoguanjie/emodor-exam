// Independent uni-app schema 3 contract. Keep validation aligned with the server via shared fixtures.
export type ContentSchema = 1 | 2 | 3;
export type RichFontFamilyV3 = 'SimSun' | 'SimHei' | 'Microsoft YaHei' | 'FangSong' | 'KaiTi';
export type RichLineHeightV3 = '1' | '1.2' | '1.5' | '1.75' | '2' | '2.5' | '3';
export type RichTextAlignV3 = 'left' | 'center' | 'right' | 'justify';
export interface RichBlockAttrsV3 {
  textAlign?: RichTextAlignV3 | null;
  indent?: number;
  lineHeight?: RichLineHeightV3 | null | 0;
}
export interface RichListItemAttrsV3 extends Omit<RichBlockAttrsV3, 'textAlign'> {}
export type ReadonlyRichMarkV3 =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'superscript' | 'subscript'; attrs?: Record<string, never> }
  | { type: 'textStyle'; attrs: { fontFamily?: RichFontFamilyV3 | null; fontSize?: string | null; color?: string | null } }
  | { type: 'highlight'; attrs: { color: string } };
export type ReadonlyRichInlineV3 =
  | { type: 'text'; text: string; marks?: ReadonlyRichMarkV3[] }
  | { type: 'hardBreak'; marks?: ReadonlyRichMarkV3[] }
  | { type: 'image'; attrs: { asset_id: string } };
export interface RichTableCellAttrsV3 {
  colspan: number;
  rowspan: number;
  colwidth: number[] | null;
  align: Exclude<RichTextAlignV3, 'justify'> | null;
}
export interface ReadonlyRichTableCellV3 {
  type: 'tableCell' | 'tableHeader';
  attrs: RichTableCellAttrsV3;
  content: ReadonlyRichBlockV3[];
}
export interface ReadonlyRichTableRowV3 { type: 'tableRow'; content: ReadonlyRichTableCellV3[] }
export interface ReadonlyRichTableV3 { type: 'table'; content: ReadonlyRichTableRowV3[] }
export interface ReadonlyRichListItemV3 {
  type: 'listItem';
  attrs?: RichListItemAttrsV3;
  content: ReadonlyRichBlockV3[];
}
export type ReadonlyRichBlockV3 =
  | { type: 'paragraph'; attrs?: RichBlockAttrsV3; content?: ReadonlyRichInlineV3[] }
  | { type: 'heading'; attrs: RichBlockAttrsV3 & { level: 1 | 2 | 3 | 4 }; content?: ReadonlyRichInlineV3[] }
  | { type: 'blockquote'; content: ReadonlyRichBlockV3[] }
  | { type: 'bulletList'; attrs?: Record<string, never>; content: ReadonlyRichListItemV3[] }
  | { type: 'orderedList'; attrs?: { start?: number; type?: '1' | 'a' | 'A' | 'i' | 'I' | null }; content: ReadonlyRichListItemV3[] }
  | { type: 'codeBlock'; attrs?: { language?: null }; content?: Array<{ type: 'text'; text: string }> }
  | { type: 'horizontalRule' }
  | ReadonlyRichTableV3;
export interface ReadonlyRichDocV3 { type: 'doc'; content: ReadonlyRichBlockV3[] }
export type ReadonlyRichNodeV3 = ReadonlyRichDocV3 | ReadonlyRichBlockV3 | ReadonlyRichInlineV3 | ReadonlyRichListItemV3 | ReadonlyRichTableRowV3 | ReadonlyRichTableCellV3;


type RecordValue = Record<string, any>;
const object = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const fonts = ['SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi'];
const lineHeights = ['1', '1.2', '1.5', '1.75', '2', '2.5', '3'];
const aligns = ['left', 'center', 'right', 'justify'];
const blocks = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule', 'table'];
function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}
function keys(value: RecordValue, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, '不支持的字段');
}
function color(value: unknown, path: string): string {
  if (typeof value !== 'string') return fail(path, '颜色必须是 hex 或 rgb');
  const trimmed = value.trim();
  const hex = /^(?:#([\da-f]{3})|#([\da-f]{6}))$/i.exec(trimmed);
  if (hex) {
    const raw = (hex[1] || hex[2]).toLowerCase();
    return raw.length === 3 ? `#${raw.split('').map((item) => item + item).join('')}` : `#${raw}`;
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(trimmed);
  if (!rgb || rgb.slice(1).some((channel) => Number(channel) > 255)) return fail(path, '颜色必须是安全 hex 或 rgb');
  return `rgb(${rgb.slice(1).map(Number).join(', ')})`;
}
function marks(value: unknown, path: string): ReadonlyRichMarkV3[] {
  if (!Array.isArray(value)) return fail(path, 'marks 必须是数组');
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const markPath = `${path}[${index}]`;
    if (!object(raw) || typeof raw.type !== 'string') return fail(markPath, 'mark 必须包含 type');
    keys(raw, ['type', 'attrs'], markPath);
    if (seen.has(raw.type)) fail(`${markPath}.type`, '不能重复 mark');
    seen.add(raw.type);
    const type = raw.type;
    if (['bold', 'italic', 'underline', 'strike', 'code', 'superscript', 'subscript'].includes(type)) {
      if (own(raw, 'attrs') && (!object(raw.attrs) || Object.keys(raw.attrs).length)) fail(`${markPath}.attrs`, '该 mark 不接受属性');
      return own(raw, 'attrs') ? { type, attrs: {} } : { type };
    }
    if (type === 'textStyle') {
      if (!object(raw.attrs)) return fail(`${markPath}.attrs`, 'textStyle 必须提供受控样式');
      keys(raw.attrs, ['fontFamily', 'fontSize', 'color'], `${markPath}.attrs`);
      const attrs: RecordValue = {};
      let populated = false;
      for (const key of Object.keys(raw.attrs)) {
        const item = raw.attrs[key];
        if (item === null) { attrs[key] = null; continue; }
        populated = true;
        if (key === 'fontFamily' && !fonts.includes(item)) fail(`${markPath}.attrs.${key}`, '字体不在允许集合内');
        if (key === 'fontSize' && (typeof item !== 'string' || !/^(?:9|1\d|2\d|3[0-6])pt$/.test(item))) fail(`${markPath}.attrs.${key}`, '字号必须是 9–36pt 整数');
        attrs[key] = key === 'color' ? color(item, `${markPath}.attrs.color`) : item;
      }
      if (!populated) fail(`${markPath}.attrs`, 'textStyle 至少包含一个有效样式');
      return { type, attrs };
    }
    if (type === 'highlight') {
      if (!object(raw.attrs)) return fail(`${markPath}.attrs`, 'highlight 必须提供颜色');
      keys(raw.attrs, ['color'], `${markPath}.attrs`);
      return { type, attrs: { color: color(raw.attrs.color, `${markPath}.attrs.color`) } };
    }
    // Links and editor controls are converted by the authoring codec, never by
    // the exam parser. No href or management metadata enters this contract.
    return fail(`${markPath}.type`, `不支持 mark ${type}`);
  }) as ReadonlyRichMarkV3[];
}
function blockAttrs(raw: unknown, path: string, mode: 'paragraph' | 'heading' | 'listItem'): RecordValue {
  if (!object(raw)) return fail(path, '块属性必须是对象');
  const allowed = mode === 'listItem' ? ['indent', 'lineHeight'] : ['textAlign', 'indent', 'lineHeight'];
  if (mode === 'heading') allowed.push('level');
  keys(raw, allowed, path);
  if (mode === 'heading' && (!Number.isInteger(raw.level) || raw.level < 1 || raw.level > 4)) fail(`${path}.level`, '标题级别只允许 1–4');
  if (own(raw, 'textAlign') && raw.textAlign !== null && !aligns.includes(raw.textAlign)) fail(`${path}.textAlign`, '文本对齐非法');
  if (own(raw, 'indent') && (!Number.isInteger(raw.indent) || raw.indent < 0 || raw.indent > 10)) fail(`${path}.indent`, '缩进只允许 0–10 整数');
  if (own(raw, 'lineHeight') && raw.lineHeight !== null && raw.lineHeight !== 0 && !lineHeights.includes(raw.lineHeight)) fail(`${path}.lineHeight`, '行距不在允许集合内');
  return { ...raw };
}

/** Adapted from the source codec's tableGridLayout/validateTableGrid rules. */
function tableGrid(table: ReadonlyRichTableV3, path: string): void {
  const rows = table.content;
  const grid: boolean[][] = rows.map(() => []);
  const widths: Array<number | undefined> = [];
  let width = 0;
  let slots = 0;
  rows.forEach((row, rowIndex) => {
    let cursor = 0;
    row.content.forEach((cell, cellIndex) => {
      const cellPath = `${path}.content[${rowIndex}].content[${cellIndex}]`;
      while (grid[rowIndex][cursor]) cursor++;
      const { colspan, rowspan, colwidth } = cell.attrs;
      if (rowIndex + rowspan > rows.length) fail(`${cellPath}.attrs.rowspan`, 'rowspan 跨出表格末行');
      if ((slots += colspan * rowspan) > 10000) fail(cellPath, '表格展开网格不能超过 10000 格');
      for (let r = rowIndex; r < rowIndex + rowspan; r++) {
        for (let c = cursor; c < cursor + colspan; c++) {
          if (grid[r][c]) fail(cellPath, '单元格与既有 rowspan/colspan 区域重叠');
          grid[r][c] = true;
        }
      }
      colwidth?.forEach((value, offset) => {
        const column = cursor + offset;
        if (widths[column] !== undefined && widths[column] !== value) fail(`${cellPath}.attrs.colwidth[${offset}]`, '同列 colwidth 冲突');
        widths[column] = value;
      });
      cursor += colspan;
      width = Math.max(width, cursor);
    });
  });
  if (width === 0) fail(`${path}.content`, '表格至少包含一个单元格');
  if (width * rows.length > 10000) fail(path, '表格展开网格不能超过 10000 格');
  grid.forEach((row, index) => {
    for (let column = 0; column < width; column++) if (!row[column]) fail(`${path}.content[${index}].content`, '表格存在缺口或缺少尾部单元格');
  });
}

/** Strict examination content only; rebuild every accepted node and attribute. */
export function validateRichDocV3(input: unknown): ReadonlyRichDocV3 {
  let nodes = 0;
  let textLength = 0;
  function read(raw: unknown, path: string, depth: number, parent: string): ReadonlyRichNodeV3 {
    if (++nodes > 2000) fail(path, '富文节点不能超过 2000');
    if (depth > 16) fail(path, '富文深度不能超过 16');
    if (!object(raw) || typeof raw.type !== 'string') return fail(path, '节点必须是包含 type 的对象');
    const type = raw.type;
    const inline = parent === 'paragraph' || parent === 'heading';
    const block = ['doc', 'blockquote', 'listItem', 'tableCell', 'tableHeader'].includes(parent);
    const allowed = parent === '' ? type === 'doc'
      : inline ? ['text', 'hardBreak', 'image'].includes(type)
        : parent === 'codeBlock' ? type === 'text'
          : ['bulletList', 'orderedList'].includes(parent) ? type === 'listItem'
            : parent === 'table' ? type === 'tableRow'
              : parent === 'tableRow' ? ['tableCell', 'tableHeader'].includes(type)
                : block && blocks.includes(type);
    if (!allowed) return fail(`${path}.type`, `不支持节点 ${type} 或节点位置非法`);
    const out: RecordValue = { type };
    const children = (required: boolean, nonempty = false) => {
      if (!own(raw, 'content') && !required) return;
      if (!Array.isArray(raw.content)) return fail(`${path}.content`, '内容必须是数组');
      if (nonempty && !raw.content.length) fail(`${path}.content`, '内容不能为空');
      out.content = raw.content.map((child: unknown, index: number) => read(child, `${path}.content[${index}]`, depth + 1, type));
    };
    if (type === 'text') {
      keys(raw, parent === 'codeBlock' ? ['type', 'text'] : ['type', 'text', 'marks'], path);
      if (typeof raw.text !== 'string' || !raw.text.length || (textLength += raw.text.length) > 100000) return fail(`${path}.text`, '富文文本为空或超过 100000 字符');
      out.text = raw.text;
      if (own(raw, 'marks')) out.marks = marks(raw.marks, `${path}.marks`);
    } else if (type === 'hardBreak') {
      keys(raw, ['type', 'marks'], path);
      if (own(raw, 'marks')) out.marks = marks(raw.marks, `${path}.marks`);
    } else if (type === 'image') {
      keys(raw, ['type', 'attrs'], path);
      if (!object(raw.attrs)) return fail(`${path}.attrs`, '图片必须提供受控 asset_id');
      keys(raw.attrs, ['asset_id'], `${path}.attrs`);
      if (typeof raw.attrs.asset_id !== 'string' || !/^[1-9]\d*$/.test(raw.attrs.asset_id)) return fail(`${path}.attrs.asset_id`, '图片只能引用受控 asset_id');
      out.attrs = { asset_id: raw.attrs.asset_id };
    } else if (type === 'horizontalRule') {
      keys(raw, ['type'], path);
    } else if (['paragraph', 'heading', 'listItem'].includes(type)) {
      keys(raw, ['type', 'attrs', 'content'], path);
      if (own(raw, 'attrs') || type === 'heading') out.attrs = blockAttrs(raw.attrs, `${path}.attrs`, type as 'paragraph' | 'heading' | 'listItem');
      children(type === 'listItem', type === 'listItem');
      if (type === 'listItem' && out.content[0].type !== 'paragraph') fail(`${path}.content[0].type`, '列表项首个块必须是 paragraph');
    } else if (type === 'bulletList' || type === 'orderedList') {
      keys(raw, ['type', 'attrs', 'content'], path);
      if (own(raw, 'attrs')) {
        if (!object(raw.attrs)) return fail(`${path}.attrs`, '列表属性必须是对象');
        keys(raw.attrs, type === 'orderedList' ? ['start', 'type'] : [], `${path}.attrs`);
        if (own(raw.attrs, 'start') && (!Number.isSafeInteger(raw.attrs.start) || raw.attrs.start < 1)) fail(`${path}.attrs.start`, '列表 start 必须是正整数');
        if (own(raw.attrs, 'type') && raw.attrs.type !== null && !['1', 'a', 'A', 'i', 'I'].includes(raw.attrs.type)) fail(`${path}.attrs.type`, '列表编号类型非法');
        out.attrs = { ...raw.attrs };
      }
      children(true, true);
    } else if (type === 'codeBlock') {
      keys(raw, ['type', 'attrs', 'content'], path);
      if (own(raw, 'attrs')) {
        if (!object(raw.attrs)) return fail(`${path}.attrs`, '代码块属性必须是对象');
        keys(raw.attrs, ['language'], `${path}.attrs`);
        if (own(raw.attrs, 'language') && raw.attrs.language !== null) fail(`${path}.attrs.language`, '未启用代码语言扩展');
        out.attrs = { ...raw.attrs };
      }
      children(false);
    } else if (type === 'tableCell' || type === 'tableHeader') {
      keys(raw, ['type', 'attrs', 'content'], path);
      if (!object(raw.attrs)) return fail(`${path}.attrs`, '单元格必须提供 attrs');
      keys(raw.attrs, ['colspan', 'rowspan', 'colwidth', 'align'], `${path}.attrs`);
      const attrs = raw.attrs;
      for (const key of ['colspan', 'rowspan']) if (!Number.isInteger(attrs[key]) || attrs[key] < 1 || attrs[key] > 100) fail(`${path}.attrs.${key}`, '单元格跨度必须是 1–100 整数');
      if (attrs.colwidth !== null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.length !== attrs.colspan || attrs.colwidth.some((value: unknown) => !Number.isInteger(value) || Number(value) < 0 || Number(value) > 10000))) fail(`${path}.attrs.colwidth`, 'colwidth 必须匹配 colspan 且只含 0–10000 整数');
      if (attrs.align !== null && !['left', 'center', 'right'].includes(attrs.align)) fail(`${path}.attrs.align`, '单元格对齐非法');
      out.attrs = { colspan: attrs.colspan, rowspan: attrs.rowspan, colwidth: attrs.colwidth === null ? null : [...attrs.colwidth], align: attrs.align };
      children(true, true);
    } else {
      keys(raw, ['type', 'content'], path);
      children(true, type === 'blockquote' || type === 'table');
      if (type === 'table') tableGrid(out as ReadonlyRichTableV3, path);
    }
    return out as ReadonlyRichNodeV3;
  }
  return read(input, '$', 1, '') as ReadonlyRichDocV3;
}

export interface RenderableRichNode {
  type: ReadonlyRichNodeV3['type'];
  children: RenderableRichNode[];
  style: Record<string, string>;
  text?: string;
  assetId?: string;
  marker?: string;
}
const fontFallbacks: Record<RichFontFamilyV3, string> = {
  SimSun: '"SimSun", "Songti SC", serif',
  SimHei: '"SimHei", "Heiti SC", sans-serif',
  'Microsoft YaHei': '"Microsoft YaHei", "PingFang SC", sans-serif',
  FangSong: '"FangSong", "STFangsong", serif',
  KaiTi: '"KaiTi", "Kaiti SC", serif',
};
function listLabel(number: number, type = '1'): string {
  if (type === 'a' || type === 'A') {
    let label = '', remaining = number;
    while (remaining > 0) { remaining--; label = String.fromCharCode(97 + remaining % 26) + label; remaining = Math.floor(remaining / 26); }
    return `${type === 'A' ? label.toUpperCase() : label}.`;
  }
  if ((type === 'i' || type === 'I') && number <= 3999) {
    const values: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let label = '', remaining = number;
    for (const [value, symbol] of values) while (remaining >= value) { label += symbol; remaining -= value; }
    return `${type === 'i' ? label.toLowerCase() : label}.`;
  }
  return `${number}.`;
}
/** Explicit display properties only; never spread author attrs into a uni node. */
export function renderableRichNodes(doc: ReadonlyRichDocV3): RenderableRichNode[] {
  function project(raw: ReadonlyRichNodeV3): RenderableRichNode {
    const node: RenderableRichNode = { type: raw.type, children: [], style: {} };
    if ('content' in raw) node.children = (raw.content || []).map(project);
    if (raw.type === 'text') node.text = raw.text;
    if (raw.type === 'image') node.assetId = raw.attrs.asset_id;
    if (raw.type === 'paragraph' || raw.type === 'heading' || raw.type === 'listItem') {
      if (raw.attrs?.indent) node.style.paddingLeft = `${raw.attrs.indent}em`;
      if (raw.attrs?.lineHeight) node.style.lineHeight = raw.attrs.lineHeight;
      if (raw.type !== 'listItem' && raw.attrs?.textAlign) node.style.textAlign = raw.attrs.textAlign;
      if (raw.type === 'heading') { node.style.fontSize = ['2em', '1.5em', '1.25em', '1.1em'][raw.attrs.level - 1]; node.style.fontWeight = '700'; }
    }
    if ('marks' in raw) {
      const decoration: string[] = [];
      for (const mark of raw.marks || []) {
        if (mark.type === 'bold') node.style.fontWeight = '700';
        else if (mark.type === 'italic') node.style.fontStyle = 'italic';
        else if (mark.type === 'underline') decoration.push('underline');
        else if (mark.type === 'strike') decoration.push('line-through');
        else if (mark.type === 'code') { node.style.fontFamily = 'monospace'; node.style.backgroundColor = '#f2f2f2'; }
        else if (mark.type === 'superscript' || mark.type === 'subscript') { node.style.verticalAlign = mark.type === 'superscript' ? 'super' : 'sub'; node.style.fontSize = '0.75em'; }
        else if (mark.type === 'highlight') node.style.backgroundColor = mark.attrs.color;
        else if (mark.type === 'textStyle') {
          if (mark.attrs.fontFamily) node.style.fontFamily = fontFallbacks[mark.attrs.fontFamily];
          if (mark.attrs.fontSize) node.style.fontSize = mark.attrs.fontSize;
          if (mark.attrs.color) node.style.color = mark.attrs.color;
        }
      }
      if (decoration.length) node.style.textDecoration = decoration.join(' ');
    }
    if (raw.type === 'bulletList' || raw.type === 'orderedList') node.children.forEach((child, index) => {
      child.marker = raw.type === 'bulletList' ? '•' : listLabel((raw.attrs?.start || 1) + index, raw.attrs?.type || '1');
    });
    if (raw.type === 'table') {
      const occupied: boolean[][] = raw.content.map(() => []), widths: number[] = [];
      node.children = [];
      raw.content.forEach((row, rowIndex) => {
        let column = 0;
        row.content.forEach(cell => {
          while (occupied[rowIndex][column]) column++;
          const { colspan, rowspan, colwidth, align } = cell.attrs, projected = project(cell);
          projected.style.gridRow = `${rowIndex + 1} / span ${rowspan}`;
          projected.style.gridColumn = `${column + 1} / span ${colspan}`;
          if (align) projected.style.textAlign = align;
          for (let r = rowIndex; r < rowIndex + rowspan; r++) for (let c = column; c < column + colspan; c++) occupied[r][c] = true;
          for (let offset = 0; offset < colspan; offset++) { const position = column + offset; widths[position] = colwidth?.[offset] || widths[position] || 96; }
          column += colspan; node.children.push(projected);
        });
      });
      node.style.gridTemplateColumns = widths.map(width => `${width}px`).join(' ');
      node.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    }
    return node;
  }
  return doc.content.map(project);
}
