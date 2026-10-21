import ExcelJS from 'exceljs';
import { Errors } from '../../common/errors';

export type QuestionImportFormat = 'xlsx' | 'txt';

export const QUESTION_IMPORT_HEADERS = [
  'category', 'type', 'difficulty', 'concept', 'stem',
  'options', 'answer', 'analysis', 'rubric', 'score',
] as const;

type QuestionImportHeader = (typeof QUESTION_IMPORT_HEADERS)[number];

export type ParsedQuestionImportRow = Record<QuestionImportHeader, string> & {
  row: number;
  format_errors?: string[];
};

export interface QuestionImportLimits {
  maxBytes: number;
  maxRows: number;
}

const DEFAULT_LIMITS: QuestionImportLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 1000,
};

const TEMPLATE_ROWS: Array<Record<QuestionImportHeader, string>> = [
  {
    category: '', type: 'single', difficulty: 'easy', concept: '',
    stem: '<p>进入作业区域前首先应做什么？</p>',
    options: JSON.stringify([{ key: 'A', text: '完成风险确认' }, { key: 'B', text: '直接开始作业' }]),
    answer: JSON.stringify([0]), analysis: '<p>应先完成风险确认。</p>', rubric: '', score: '5',
  },
  {
    category: '', type: 'multiple', difficulty: 'medium', concept: '',
    stem: '<p>以下哪些属于作业前检查？</p>',
    options: JSON.stringify([{ key: 'A', text: '检查防护用品' }, { key: 'B', text: '确认作业许可' }, { key: 'C', text: '跳过交底' }]),
    answer: JSON.stringify([0, 1]), analysis: '<p>防护用品和作业许可均须确认。</p>', rubric: '', score: '10',
  },
  {
    category: '', type: 'judgment', difficulty: 'hard', concept: '',
    stem: '<p>未完成安全交底也可以开始作业。</p>',
    options: JSON.stringify([{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]),
    answer: JSON.stringify([1]), analysis: '<p>必须先完成安全交底。</p>', rubric: '', score: '5',
  },
  {
    category: '', type: 'image', difficulty: 'hard', concept: '',
    stem: '<p>上传现场照片并标出隐患位置。</p>',
    options: JSON.stringify([]), answer: JSON.stringify([]), analysis: '',
    rubric: '<p>隐患识别完整、位置准确。</p>', score: '10',
  },
];

function assertFormat(format: string): asserts format is QuestionImportFormat {
  if (format !== 'xlsx' && format !== 'txt') throw Errors.param('format 必须是 xlsx 或 txt');
}

function assertFile(file: Buffer, limits: QuestionImportLimits): void {
  if (!Buffer.isBuffer(file) || file.length === 0) throw Errors.param('文件为空');
  if (file.length > limits.maxBytes) throw Errors.fileTooLarge('导入文件超过大小上限');
}

function assertHeader(values: string[]): void {
  if (values.length !== QUESTION_IMPORT_HEADERS.length
    || QUESTION_IMPORT_HEADERS.some((header, index) => values[index] !== header)) {
    throw Errors.param('模板表头不符，请下载最新导入模板填写');
  }
}

function rowFromCells(row: number, cells: string[], formatErrors: string[] = []): ParsedQuestionImportRow {
  const parsed = { row } as ParsedQuestionImportRow;
  QUESTION_IMPORT_HEADERS.forEach((header, index) => {
    parsed[header] = String(cells[index] ?? '').trim();
  });
  if (formatErrors.length) parsed.format_errors = formatErrors;
  return parsed;
}

function excelCellText(cell: ExcelJS.Cell): { text: string; error?: string } {
  const value = cell.value as any;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return { text: '', error: `${QUESTION_IMPORT_HEADERS[Number(cell.col) - 1] || `第${cell.col}列`} 不允许使用公式` };
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
  if (worksheet.getRow(1).actualCellCount !== QUESTION_IMPORT_HEADERS.length) {
    throw Errors.param('模板表头不符，请下载最新导入模板填写');
  }
  const header = QUESTION_IMPORT_HEADERS.map((_item, index) => excelCellText(worksheet.getRow(1).getCell(index + 1)).text.trim());
  assertHeader(header);

  const rows: ParsedQuestionImportRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: string[] = [];
    const errors: string[] = [];
    if (excelRow.actualCellCount > QUESTION_IMPORT_HEADERS.length) errors.push('Excel 每行必须使用 10 列');
    QUESTION_IMPORT_HEADERS.forEach((_header, index) => {
      const parsed = excelCellText(excelRow.getCell(index + 1));
      cells.push(parsed.text);
      if (parsed.error) errors.push(parsed.error);
    });
    if (cells.every((cell) => cell.trim() === '') && errors.length === 0) return;
    rows.push(rowFromCells(rowNumber, cells, errors));
  });
  if (!rows.length) throw Errors.param('文件为空或无数据行');
  if (rows.length > limits.maxRows) throw Errors.param(`单次导入上限 ${limits.maxRows} 行`);
  return rows;
}

function parseTxt(file: Buffer, limits: QuestionImportLimits): ParsedQuestionImportRow[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(file);
  } catch {
    throw Errors.fileFormat('TXT 必须使用 UTF-8 编码');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r\n|\n|\r/);
  const header = (lines.shift() || '').split('\t').map((cell) => cell.trim());
  assertHeader(header);
  const rows: ParsedQuestionImportRow[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const cells = line.split('\t');
    if (cells.length !== QUESTION_IMPORT_HEADERS.length) {
      rows.push(rowFromCells(index + 2, cells.slice(0, QUESTION_IMPORT_HEADERS.length), ['TXT 每行必须使用 10 列制表符分隔']));
      return;
    }
    rows.push(rowFromCells(index + 2, cells));
  });
  if (!rows.length) throw Errors.param('文件为空或无数据行');
  if (rows.length > limits.maxRows) throw Errors.param(`单次导入上限 ${limits.maxRows} 行`);
  return rows;
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

export async function buildQuestionImportTemplate(format: QuestionImportFormat): Promise<Buffer> {
  assertFormat(format);
  if (format === 'txt') {
    const lines = [
      QUESTION_IMPORT_HEADERS.join('\t'),
      ...TEMPLATE_ROWS.map((row) => QUESTION_IMPORT_HEADERS.map((header) => row[header]).join('\t')),
    ];
    return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('题库导入模板');
  worksheet.addRow([...QUESTION_IMPORT_HEADERS]);
  for (const row of TEMPLATE_ROWS) worksheet.addRow(QUESTION_IMPORT_HEADERS.map((header) => row[header]));
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column, index) => {
    column.width = ['stem', 'options', 'answer', 'analysis', 'rubric'].includes(QUESTION_IMPORT_HEADERS[index]) ? 36 : 16;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}
