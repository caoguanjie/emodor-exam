import ExcelJS from 'exceljs';
import { Errors } from '../../common/errors';

export type QuestionImportFormat = 'xlsx' | 'txt';
export type QuestionImportTemplatePurpose = 'human' | 'ai';

export const QUESTION_IMPORT_HEADERS = [
  'category', 'type', 'difficulty', 'stem',
  'options', 'answer', 'analysis',
] as const;

export const HUMAN_QUESTION_IMPORT_HEADERS = [
  '试题内容', '试题类型', '选项内容', '答案', '难度',
] as const;

type QuestionImportHeader = (typeof QUESTION_IMPORT_HEADERS)[number];
type HumanQuestionImportHeader = (typeof HUMAN_QUESTION_IMPORT_HEADERS)[number];

export type ParsedQuestionImportRow = Record<QuestionImportHeader, string> & {
  row: number;
  concept?: string;
  legacy_score?: boolean;
  format_errors?: string[];
  human_format?: boolean;
};

export interface QuestionImportLimits {
  maxBytes: number;
  maxRows: number;
}

const DEFAULT_LIMITS: QuestionImportLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 1000,
};

const HUMAN_EXAMPLES: Array<Record<HumanQuestionImportHeader, string>> = [
  {
    试题内容: '进入作业区域前首先应做什么？', 试题类型: '单选题',
    选项内容: '${完成风险确认},${直接开始作业}', 答案: 'A', 难度: '简单',
  },
  {
    试题内容: '以下哪些属于作业前检查？', 试题类型: '多选题',
    选项内容: '${检查防护用品},${确认作业许可},${跳过交底}', 答案: 'A,B', 难度: '困难',
  },
  {
    试题内容: '未完成安全交底也可以开始作业。', 试题类型: '判断题',
    选项内容: '', 答案: '错', 难度: '',
  },
];

const HUMAN_TYPES: Record<string, string> = {
  单选题: 'single',
  多选题: 'multiple',
  判断题: 'judgment',
};

function assertFormat(format: string): asserts format is QuestionImportFormat {
  if (format !== 'xlsx' && format !== 'txt') throw Errors.param('format 必须是 xlsx 或 txt');
}

function assertPurpose(purpose: string): asserts purpose is QuestionImportTemplatePurpose {
  if (purpose !== 'human' && purpose !== 'ai') throw Errors.param('purpose 必须是 human 或 ai');
}

function assertFile(file: Buffer, limits: QuestionImportLimits): void {
  if (!Buffer.isBuffer(file) || file.length === 0) throw Errors.param('文件为空');
  if (file.length > limits.maxBytes) throw Errors.fileTooLarge('导入文件超过大小上限');
}

/** Recognize both retired columns by name; their removal must never shift cells. */
function assertCanonicalHeader(values: string[]): void {
  const current = values.filter((header) => header !== 'concept' && header !== 'score');
  const legacyOrder = ['category', 'type', 'difficulty', 'concept', 'stem', 'options', 'answer', 'analysis', 'score'];
  if (new Set(values).size !== values.length
    || current.length !== QUESTION_IMPORT_HEADERS.length
    || current.some((header, index) => header !== QUESTION_IMPORT_HEADERS[index])
    || values.some((header, index) => index > 0 && legacyOrder.indexOf(header) <= legacyOrder.indexOf(values[index - 1]))) {
    throw Errors.param('模板表头不符，请使用中文 5 列模板或兼容的英文模板');
  }
}

function isHumanHeader(values: string[]): boolean {
  return (values.length === 4 || values.length === 5)
    && values.every((header, index) => header === HUMAN_QUESTION_IMPORT_HEADERS[index]);
}

function rowFromCells(row: number, cells: string[], headers: string[], formatErrors: string[] = []): ParsedQuestionImportRow {
  const parsed = { row } as ParsedQuestionImportRow;
  QUESTION_IMPORT_HEADERS.forEach((header) => {
    parsed[header] = String(cells[headers.indexOf(header)] ?? '').trim();
  });
  if (headers.includes('concept')) parsed.concept = String(cells[headers.indexOf('concept')] ?? '').trim();
  if (headers.includes('score')) parsed.legacy_score = true;
  if (formatErrors.length) parsed.format_errors = formatErrors;
  return parsed;
}

function humanOptions(value: string, type: string, errors: string[]): Array<{ key: string; text: string }> {
  if (type === 'judgment') {
    if (value.trim()) errors.push('判断题的选项内容应留空');
    return [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
  }
  const input = value.trim();
  if (!input) {
    errors.push('选择题的选项内容必填，必须使用 ${内容},${内容} 格式');
    return [];
  }
  const values: string[] = [];
  const pattern = /\$\{([^{}]*)\}/g;
  let cursor = 0;
  for (const match of input.matchAll(pattern)) {
    const separator = input.slice(cursor, match.index).trim();
    if ((values.length === 0 && separator) || (values.length > 0 && !/^[,，]$/.test(separator))) {
      errors.push('选项内容必须使用 ${内容},${内容} 格式');
      return [];
    }
    const text = match[1].trim();
    if (!text) {
      errors.push('选项内容不能为空');
      return [];
    }
    values.push(text);
    cursor = Number(match.index) + match[0].length;
  }
  if (!values.length || input.slice(cursor).trim()) {
    errors.push('选项内容必须使用 ${内容},${内容} 格式');
    return [];
  }
  return values.map((text, index) => ({ key: String.fromCharCode(65 + index), text }));
}

function humanAnswer(value: string, type: string, errors: string[]): number[] {
  const input = value.trim();
  if (type === 'judgment') {
    if (input === '对') return [0];
    if (input === '错') return [1];
    errors.push('判断题答案必须填写对或错');
    return [];
  }
  if (!input) {
    errors.push('答案必填；单选填写 A，多选填写 A,B');
    return [];
  }
  const letters = input.split(/[,，、]/).map((item) => item.trim().toUpperCase());
  if (letters.some((item) => !/^[A-Z]$/.test(item)) || new Set(letters).size !== letters.length) {
    errors.push('答案必须使用不重复的字母，多个答案用逗号分隔，例如 A,B');
    return [];
  }
  return letters.map((letter) => letter.charCodeAt(0) - 65);
}

function humanRow(
  row: number,
  values: Partial<Record<HumanQuestionImportHeader, string>>,
  formatErrors: string[] = [],
): ParsedQuestionImportRow {
  const errors = [...formatErrors];
  const rawType = String(values.试题类型 ?? '').trim();
  const type = HUMAN_TYPES[rawType] || rawType;
  if (!HUMAN_TYPES[rawType]) errors.push('试题类型必须填写单选题、多选题或判断题');
  const rawDifficulty = String(values.难度 ?? '').trim();
  const difficulty = rawDifficulty === '' || rawDifficulty === '简单' ? 'easy'
    : rawDifficulty === '困难' ? 'hard' : rawDifficulty;
  if (rawDifficulty && rawDifficulty !== '简单' && rawDifficulty !== '困难') {
    errors.push('难度必须填写简单或困难，留空按简单');
  }
  const options = humanOptions(String(values.选项内容 ?? ''), type, errors);
  const answer = humanAnswer(String(values.答案 ?? ''), type, errors);
  return {
    row,
    category: '',
    type,
    difficulty,
    stem: String(values.试题内容 ?? '').trim(),
    options: JSON.stringify(options),
    answer: JSON.stringify(answer),
    analysis: '',
    human_format: true,
    ...(errors.length ? { format_errors: errors } : {}),
  };
}

function excelCellText(cell: ExcelJS.Cell, header?: string): { text: string; error?: string } {
  const value = cell.value as any;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return { text: '', error: `${header || `第${cell.col}列`} 不允许使用公式` };
  }
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return { text: value.richText.map((part: any) => String(part?.text || '')).join('') };
    if ('text' in value) return { text: String(value.text ?? '') };
    return { text: String(cell.text || '') };
  }
  return { text: String(value) };
}

async function parseXlsx(file: Buffer, limits: QuestionImportLimits): Promise<ParsedQuestionImportRow[]> {
  if (file.length < 4 || file[0] !== 0x50 || file[1] !== 0x4b) {
    throw Errors.fileFormat('仅支持 .xlsx Excel 文件');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as any);
  } catch {
    throw Errors.fileFormat('仅支持 .xlsx Excel 文件');
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw Errors.param('文件为空或无数据行');
  const header = Array.from({ length: worksheet.getRow(1).cellCount }, (_item, index) => excelCellText(worksheet.getRow(1).getCell(index + 1)).text.trim());
  const human = isHumanHeader(header);
  if (!human) assertCanonicalHeader(header);

  const rows: ParsedQuestionImportRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: string[] = [];
    const errors: string[] = [];
    let hasExtraCell = false;
    excelRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (columnNumber <= header.length) return;
      const parsed = excelCellText(cell);
      if (!parsed.error && parsed.text.trim() === '') return;
      hasExtraCell = true;
      if (parsed.error) errors.push(parsed.error);
    });
    if (hasExtraCell) errors.unshift(`Excel 每行必须使用 ${header.length} 列`);
    header.forEach((name, index) => {
      // A retired score is never evaluated, validated or exposed.
      if (!human && name === 'score') { cells.push(''); return; }
      const parsed = excelCellText(excelRow.getCell(index + 1), name);
      cells.push(parsed.text);
      if (parsed.error) errors.push(parsed.error);
    });
    if (cells.every((cell) => cell.trim() === '') && errors.length === 0) return;
    if (human) {
      const values = Object.fromEntries(header.map((name, index) => [name, cells[index]])) as Partial<Record<HumanQuestionImportHeader, string>>;
      rows.push(humanRow(rowNumber, values, errors));
    } else {
      rows.push(rowFromCells(rowNumber, cells, header, errors));
    }
  });
  if (!rows.length) throw Errors.param('文件为空或无数据行');
  if (rows.length > limits.maxRows) throw Errors.param(`单次导入上限 ${limits.maxRows} 行`);
  return rows;
}

function decodeTxt(file: Buffer): string {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(file);
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  } catch {
    throw Errors.fileFormat('TXT 必须使用 UTF-8 编码');
  }
}

function parseHumanTxt(text: string, limits: QuestionImportLimits): ParsedQuestionImportRow[] {
  const lines = text.split(/\r\n|\n|\r/);
  const rows: ParsedQuestionImportRow[] = [];
  let values: Partial<Record<HumanQuestionImportHeader, string>> | null = null;
  let errors: string[] = [];
  let startRow = 1;
  let current: HumanQuestionImportHeader | null = null;
  const labelMap: Record<string, HumanQuestionImportHeader> = {
    题干: '试题内容', 类型: '试题类型', 选项: '选项内容', 答案: '答案', 难度: '难度',
  };
  const finish = () => {
    if (!values) return;
    rows.push(humanRow(startRow, values, errors));
    values = null;
    errors = [];
    current = null;
  };

  lines.forEach((line, index) => {
    const physicalRow = index + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return;
    if (!trimmed) { finish(); return; }
    const label = line.match(/^\s*\[([^\]]+)\](.*)$/);
    if (label) {
      const mapped = labelMap[label[1].trim()];
      if (mapped === '试题内容' && values?.试题内容 !== undefined) finish();
      if (!values) { values = {}; startRow = physicalRow; }
      if (!mapped) {
        errors.push(`TXT 第 ${physicalRow} 行包含未知标签 [${label[1].trim()}]`);
        current = null;
        return;
      }
      if (values[mapped] !== undefined) errors.push(`TXT 第 ${physicalRow} 行重复填写 [${label[1].trim()}]`);
      values[mapped] = label[2].trim();
      current = mapped;
      return;
    }
    if (!values || !current) {
      if (!values) { values = {}; startRow = physicalRow; }
      errors.push(`TXT 第 ${physicalRow} 行必须以 [题干]、[类型]、[选项]、[答案] 或 [难度] 开头`);
      return;
    }
    values[current] = `${values[current] || ''}\n${line}`.trim();
  });
  finish();
  if (!rows.length) throw Errors.param('文件为空或无数据行');
  if (rows.length > limits.maxRows) throw Errors.param(`单次导入上限 ${limits.maxRows} 行`);
  return rows;
}

function parseCanonicalTxt(text: string, limits: QuestionImportLimits): ParsedQuestionImportRow[] {
  const lines = text.split(/\r\n|\n|\r/);
  const header = (lines.shift() || '').split('\t').map((cell) => cell.trim());
  assertCanonicalHeader(header);
  const rows: ParsedQuestionImportRow[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const cells = line.split('\t');
    if (cells.length !== header.length) {
      rows.push(rowFromCells(index + 2, cells, header, [`TXT 每行必须使用 ${header.length} 列制表符分隔`]));
      return;
    }
    rows.push(rowFromCells(index + 2, cells, header));
  });
  if (!rows.length) throw Errors.param('文件为空或无数据行');
  if (rows.length > limits.maxRows) throw Errors.param(`单次导入上限 ${limits.maxRows} 行`);
  return rows;
}

function parseTxt(file: Buffer, limits: QuestionImportLimits): ParsedQuestionImportRow[] {
  const text = decodeTxt(file);
  const firstContent = text.split(/\r\n|\n|\r/).find((line) => line.trim() && !line.trim().startsWith('#'))?.trim() || '';
  return /^\[[^\]]+\]/.test(firstContent)
    ? parseHumanTxt(text, limits)
    : parseCanonicalTxt(text, limits);
}

export async function parseQuestionImportFile(
  file: Buffer,
  format: QuestionImportFormat,
  limits: QuestionImportLimits = DEFAULT_LIMITS,
): Promise<ParsedQuestionImportRow[]> {
  assertFormat(format);
  assertFile(file, limits);
  return format === 'xlsx' ? parseXlsx(file, limits) : parseTxt(file, limits);
}

function styleTemplateSheet(sheet: ExcelJS.Worksheet): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).height = 30;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3156D3' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

async function buildHumanXlsxTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('试题导入模板');
  worksheet.addRow([...HUMAN_QUESTION_IMPORT_HEADERS]);
  worksheet.columns = HUMAN_QUESTION_IMPORT_HEADERS.map((header, index) => ({
    header, width: [46, 16, 60, 18, 14][index],
  }));
  worksheet.autoFilter = 'A1:E1';
  for (const column of [1, 3, 4, 5]) worksheet.getColumn(column).numFmt = '@';
  for (let row = 2; row <= 1001; row++) {
    worksheet.getCell(row, 2).dataValidation = {
      type: 'list', formulae: ['"单选题,多选题,判断题"'], allowBlank: false,
      showErrorMessage: true, errorStyle: 'stop', errorTitle: '试题类型不正确',
      error: '请选择单选题、多选题或判断题。',
    };
    worksheet.getCell(row, 5).dataValidation = {
      type: 'list', formulae: ['"简单,困难"'], allowBlank: true,
      showErrorMessage: true, errorStyle: 'stop', errorTitle: '难度不正确',
      error: '请选择简单或困难；留空按简单。',
    };
  }

  const examples = workbook.addWorksheet('填写示例');
  examples.addRow([...HUMAN_QUESTION_IMPORT_HEADERS]);
  HUMAN_EXAMPLES.forEach((row) => examples.addRow(HUMAN_QUESTION_IMPORT_HEADERS.map((header) => row[header])));
  examples.addRow([]);
  examples.addRow(['以上为合成示例，不参与导入。请在第一个工作表填写真实试题。']);
  examples.mergeCells('A6:E6');
  examples.getRow(6).height = 42;
  examples.getCell('A6').alignment = { wrapText: true, vertical: 'middle' };
  examples.columns.forEach((column, index) => { column.width = [46, 16, 60, 18, 14][index] || 20; });

  const instructions = workbook.addWorksheet('填写说明');
  instructions.columns = [{ width: 24 }, { width: 110 }];
  [
    ['项目', '填写要求'],
    ['导入范围', '只导入第一个工作表；填写示例和本说明不会导入。请勿修改表头或增加列，空行跳过，最多 1000 题。'],
    ['试题内容', '必填，按纯文本导入；Excel 单元格内换行会保留。图片请在题库编辑器中按受控媒体规则添加。'],
    ['试题类型', '从下拉列表选择单选题、多选题或判断题。'],
    ['选项内容', '单选题和多选题按 ${选项A},${选项B},${选项C} 填写；判断题留空。'],
    ['答案', '单选填写 A；多选填写 A,C；判断题填写 对 或 错。答案字母必须与选项顺序对应。'],
    ['难度', '只填简单或困难；留空按简单。兼容没有难度列的旧四列表格。'],
    ['培训类别', '不写入模板。上传前在页面选择，所选类别对整批试题生效，并覆盖旧英文文件中的类别。'],
    ['分值', '题库不设分值；分值在组卷时设置。'],
  ].forEach((row) => instructions.addRow(row));
  instructions.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'middle' }; row.height = 36; });
  [worksheet, examples, instructions].forEach(styleTemplateSheet);
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}

function buildHumanTxtTemplate(): Buffer {
  const lines = [
    '# 试题导入 TXT 模板（UTF-8）',
    '# 一题一个区块；请替换或删除示例后上传。以 # 开头的整行是注释，不参与导入。',
    '# 选项使用 ${内容},${内容}；单选答案如 A，多选答案如 A,C，判断答案填 对 或 错。',
    '# [难度] 只填简单或困难，留空或省略时按简单。',
    '',
    ...HUMAN_EXAMPLES.flatMap((example, index) => [
      `[题干]${example.试题内容}`,
      `[类型]${example.试题类型}`,
      `[选项]${example.选项内容}`,
      `[答案]${example.答案}`,
      `[难度]${example.难度}`,
      ...(index < HUMAN_EXAMPLES.length - 1 ? [''] : []),
    ]),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function buildQuestionImportTemplate(
  format: QuestionImportFormat,
  purpose: QuestionImportTemplatePurpose = 'human',
): Promise<Buffer> {
  assertFormat(format);
  assertPurpose(purpose);
  return format === 'xlsx' ? buildHumanXlsxTemplate() : buildHumanTxtTemplate();
}

/** Canonical seven-column writer used by generated-result downloads and legacy file compatibility. */
export async function buildQuestionImportFile(
  format: QuestionImportFormat,
  rows: Array<Record<QuestionImportHeader, string>>,
): Promise<Buffer> {
  assertFormat(format);
  if (format === 'txt') {
    const lines = [
      QUESTION_IMPORT_HEADERS.join('\t'),
      ...rows.map((row) => QUESTION_IMPORT_HEADERS.map((header) => row[header].replace(/[\t\r\n]/g, ' ')).join('\t')),
    ];
    return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('题库导入模板');
  worksheet.addRow([...QUESTION_IMPORT_HEADERS]);
  for (const row of rows) worksheet.addRow(QUESTION_IMPORT_HEADERS.map((header) => row[header]));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).getCell(7).note = '题库不设分值；分值在组卷时设置。旧模板 score 列兼容接收并忽略；concept 必须为空。';
  worksheet.columns.forEach((column, index) => {
    column.width = ['stem', 'options', 'answer', 'analysis'].includes(QUESTION_IMPORT_HEADERS[index]) ? 36 : 16;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}
