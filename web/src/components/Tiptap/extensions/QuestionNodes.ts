import {
  Extension,
  Node,
  type Editor,
  type Extensions,
  type JSONContent,
} from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import type {
  QuestionMeta,
  ReviewOptionState,
} from '../../../api/question-document-types';
import { ControlType, type TemplateControl } from '../type';
import {
  CONTROLLED_UPDATE_META,
  isEditorMutationAllowed,
} from '../utils/widgetNodeViewRegistry';
import QuestionBlockView from '../widget/QuestionBlockView.vue';
import QuestionOptionView from '../widget/QuestionOptionView.vue';
import { nanoid } from './WidgetNodes';
import { createQuestionEditingProtection, QUESTION_STRUCTURE_META } from './QuestionEditingProtection';

/** Runtime authoring also serves the score-free question-bank editor. Paper metadata stays strict. */
export type QuestionRuntimeMeta = Omit<QuestionMeta, 'score_cents'> & { score_cents?: number };
export interface QuestionNodeRuntime {
  canReorderOptions?: () => boolean;
  showAnswerLabels?: () => boolean;
  protectStructure?: () => boolean;
  allowStructure?: () => boolean;
  onEditBlocked?: (message: string) => void;
  onUploadsChange?: (state: { pending: boolean; count: number }) => void;
  onQuestionRemoveRequest?: (clientId: string) => void;
  onQuestionMoveRequest?: (change: { client_id: string; to_index: number }) => void;
  getQuestionMeta?: (clientId: string) => QuestionRuntimeMeta | undefined;
  getDisplayMeta?: (clientId: string) => { type: QuestionMeta['type']; hideOrdinal?: boolean } | undefined;
  getMode?: () => 'edit' | 'preview' | 'review';
  getReviewState?: (clientId: string) => ReviewOptionState[] | undefined;
  onQuestionMetaChange?: (change: { client_id: string; patch: Partial<QuestionMeta> }) => void;
}

export interface AuthoringControlDecision {
  allowed: boolean;
  action: 'insert-widget' | 'create-question' | 'add-option' | 'reject';
  reason?: string;
  clientId?: string;
}

interface QuestionContext {
  node: ProseMirrorNode;
  pos: number;
  clientId: string;
}

interface QuestionExtensionOptions {
  runtime: QuestionNodeRuntime;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    questionNodes: {
      insertAuthoringControl: (attrs: Partial<TemplateControl>, position?: number) => ReturnType;
      addQuestionOption: (clientId: string) => ReturnType;
      removeQuestionOption: (optionId: string) => ReturnType;
      moveQuestionOption: (optionId: string, toIndex: number) => ReturnType;
      setQuestionOptionChecked: (optionId: string, checked: boolean) => ReturnType;
    };
  }
}

function isGeneralWidget(type: unknown): boolean {
  return [
    ControlType.text,
    ControlType.select,
    ControlType.date,
    ControlType.inputNumber,
    ControlType.location,
  ].includes(Number(type));
}

function questionTypeForControl(type: unknown): QuestionMeta['type'] | null {
  if (Number(type) === ControlType.radio) return 'single';
  if (Number(type) === ControlType.checkbox) return 'multiple';
  return null;
}

function normalizeGeneralWidget(attrs: Partial<TemplateControl>): Partial<TemplateControl> {
  const type = Number(attrs.type) as ControlType;
  const select = type === ControlType.select;
  return {
    ...attrs,
    type,
    options: select ? (attrs.options ?? '1:选项1\n2:选项2\n3:选项3') : null,
    dynamicOptions: select && Array.isArray(attrs.dynamicOptions) ? attrs.dynamicOptions : null,
    isMultiple: select && Number(attrs.isMultiple) === 1 ? 1 : 0,
    dataSourceCode: attrs.dataSourceCode === '' ? '' : null,
    group: null,
    checked: false,
    layout: 1,
  } as unknown as Partial<TemplateControl>;
}

function safePosition(document: ProseMirrorNode, position: number): number {
  return Math.max(0, Math.min(Number.isFinite(position) ? Math.trunc(position) : 0, document.content.size));
}

function questionContextAt(document: ProseMirrorNode, position: number): QuestionContext | null {
  const $position = document.resolve(safePosition(document, position));
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.type.name === 'questionBlock') {
      return {
        node,
        pos: $position.before(depth),
        clientId: String(node.attrs.client_id),
      };
    }
  }
  return null;
}

function isInsideQuestionContent(document: ProseMirrorNode, position: number): boolean {
  const $position = document.resolve(safePosition(document, position));
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const name = $position.node(depth).type.name;
    if (name === 'questionStem' || name === 'questionOption') return true;
  }
  return false;
}

function runtimeFromEditor(editor: Editor): QuestionNodeRuntime {
  const extension = editor.extensionManager.extensions.find(({ name }) => name === 'questionCommands');
  return (extension?.options as QuestionExtensionOptions | undefined)?.runtime ?? {};
}

function decideControl(
  document: ProseMirrorNode,
  position: number,
  attrs: Partial<TemplateControl>,
  runtime: QuestionNodeRuntime,
): AuthoringControlDecision {
  if (isGeneralWidget(attrs.type)) {
    return isInsideQuestionContent(document, position)
      ? { allowed: true, action: 'insert-widget' }
      : { allowed: false, action: 'reject', reason: '通用控件只能放入题干或选项内容' };
  }

  const expectedType = questionTypeForControl(attrs.type);
  if (!expectedType) return { allowed: false, action: 'reject', reason: '不支持此控件类型' };
  const context = questionContextAt(document, position);
  if (!context) return { allowed: true, action: 'create-question' };

  const actualType = runtime.getQuestionMeta?.(context.clientId)?.type;
  if (!actualType) {
    return {
      allowed: false,
      action: 'reject',
      clientId: context.clientId,
      reason: '题目元信息尚未就绪，不能增加选项',
    };
  }
  if (actualType !== expectedType) {
    return {
      allowed: false,
      action: 'reject',
      clientId: context.clientId,
      reason: `不能把${expectedType === 'single' ? '单选' : '多选'}控件放入其他题型`,
    };
  }
  if (context.node.childCount - 1 >= 26) {
    return { allowed: false, action: 'reject', clientId: context.clientId, reason: '每题最多 26 个选项' };
  }
  return { allowed: true, action: 'add-option', clientId: context.clientId };
}

export function getAuthoringControlDecision(
  editor: Editor,
  attrs: Partial<TemplateControl>,
  position = editor.state.selection.from,
): AuthoringControlDecision {
  return decideControl(editor.state.doc, position, attrs, runtimeFromEditor(editor));
}

function optionJSON(text = ''): JSONContent {
  return {
    type: 'questionOption',
    attrs: { option_id: nanoid(), checked: false },
    content: [{
      type: 'paragraph',
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    }],
  };
}

function questionJSON(): JSONContent {
  return {
    type: 'questionBlock',
    attrs: { client_id: nanoid() },
    content: [
      { type: 'questionStem', content: [{ type: 'paragraph' }] },
      optionJSON('选项1'),
    ],
  };
}

function findQuestionOption(document: ProseMirrorNode, optionId: string) {
  const matches: Array<{ node: ProseMirrorNode; pos: number }> = [];
  document.descendants((node, pos) => {
    if (node.type.name === 'questionOption' && node.attrs.option_id === optionId) {
      matches.push({ node, pos });
    }
  });
  return matches.length === 1 ? matches[0] : null;
}

function questionBlockById(document: ProseMirrorNode, clientId: string): ProseMirrorNode | null {
  let result: ProseMirrorNode | null = null;
  document.forEach((node) => {
    if (node.type.name === 'questionBlock' && node.attrs.client_id === clientId) result = node;
  });
  return result;
}

function questionContextById(document: ProseMirrorNode, clientId: string): QuestionContext | null {
  const matches: QuestionContext[] = [];
  document.forEach((node, pos) => {
    if (node.type.name === 'questionBlock' && node.attrs.client_id === clientId) matches.push({ node, pos, clientId });
  });
  return matches.length === 1 ? matches[0] : null;
}

function canEditQuestionOptions(editor: Editor, runtime: QuestionNodeRuntime, context: QuestionContext): boolean {
  const type = runtime.getQuestionMeta?.(context.clientId)?.type;
  return isEditorMutationAllowed(editor) && (runtime.getMode?.() ?? 'edit') === 'edit'
    && (type === 'single' || type === 'multiple');
}

function optionsJSON(block: ProseMirrorNode): string {
  const options: unknown[] = [];
  block.forEach((node) => {
    if (node.type.name === 'questionOption') options.push(node.toJSON());
  });
  return JSON.stringify(options);
}

function isPlainJudgmentOption(node: ProseMirrorNode, expected: string): boolean {
  if (node.type.name !== 'questionOption' || node.childCount !== 1) return false;
  const paragraph = node.child(0);
  if (paragraph.type.name !== 'paragraph' || paragraph.childCount !== 1) return false;
  const text = paragraph.child(0);
  if (!text.isText || text.text !== expected || text.marks.length > 0) return false;
  const attrs = paragraph.attrs;
  return (attrs.textAlign === undefined || attrs.textAlign === null)
    && (attrs.indent === undefined || attrs.indent === 0)
    && (attrs.lineHeight === undefined || attrs.lineHeight === null || attrs.lineHeight === 0);
}

function hasFixedJudgmentOptions(block: ProseMirrorNode): boolean {
  const options: ProseMirrorNode[] = [];
  block.forEach((node) => {
    if (node.type.name === 'questionOption') options.push(node);
  });
  return options.length === 2
    && isPlainJudgmentOption(options[0], '正确')
    && isPlainJudgmentOption(options[1], '错误');
}

function preservesQuestionBusinessStructure(
  previous: ProseMirrorNode,
  next: ProseMirrorNode,
  runtime: QuestionNodeRuntime,
): boolean {
  let allowed = true;
  next.forEach((block) => {
    if (!allowed || block.type.name !== 'questionBlock') return;
    const clientId = String(block.attrs.client_id);
    const meta = runtime.getQuestionMeta?.(clientId);
    if (meta?.type !== 'judgment') return;
    const oldBlock = questionBlockById(previous, clientId);
    if (oldBlock && optionsJSON(oldBlock) === optionsJSON(block)) return;
    allowed = hasFixedJudgmentOptions(block);
  });
  return allowed;
}

const QuestionDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'questionBlock*',
});

const QuestionBlock = Node.create<QuestionExtensionOptions>({
  name: 'questionBlock',
  content: 'questionStem questionOption*',
  defining: true,
  isolating: true,
  selectable: true,

  addOptions() {
    return { runtime: {} };
  },

  addAttributes() {
    return {
      client_id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-client-id'),
        renderHTML: (attributes) => ({ 'data-client-id': attributes.client_id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: '[data-question-block][data-client-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', { ...HTMLAttributes, 'data-question-block': '' }, 0];
  },

  addNodeView() {
    return VueNodeViewRenderer(QuestionBlockView);
  },
});

const QuestionStem = Node.create({
  name: 'questionStem',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-question-stem]' }];
  },

  renderHTML() {
    return ['div', { 'data-question-stem': '' }, 0];
  },
});

const QuestionOption = Node.create<QuestionExtensionOptions>({
  name: 'questionOption',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: true,

  addOptions() {
    return { runtime: {} };
  },

  addAttributes() {
    return {
      option_id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-option-id'),
        renderHTML: (attributes) => ({ 'data-option-id': attributes.option_id }),
      },
      checked: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-checked') === 'true',
        renderHTML: (attributes) => ({ 'data-checked': String(attributes.checked === true) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: '[data-question-option][data-option-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-question-option': '' }, 0];
  },

  addNodeView() {
    return VueNodeViewRenderer(QuestionOptionView);
  },
});

const QuestionCommands = Extension.create<QuestionExtensionOptions>({
  name: 'questionCommands',

  addOptions() {
    return { runtime: {} };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('questionBusinessGuard'),
      filterTransaction: (transaction, state) => (
        !transaction.docChanged
        || transaction.getMeta(CONTROLLED_UPDATE_META) === true
        || preservesQuestionBusinessStructure(state.doc, transaction.doc, this.options.runtime)
      ),
    })];
  },

  addCommands() {
    return {
      insertAuthoringControl: (attrs, requestedPosition) => ({ editor, state, dispatch, commands }) => {
        if (!isEditorMutationAllowed(editor)) return false;
        const position = safePosition(state.doc, requestedPosition ?? state.selection.from);
        const decision = decideControl(state.doc, position, attrs, this.options.runtime);
        if (!decision.allowed) return false;

        if (decision.action === 'insert-widget') {
          if (requestedPosition !== undefined && !commands.setTextSelection(position)) return false;
          return commands.insertField(normalizeGeneralWidget(attrs));
        }

        if (decision.action === 'create-question') {
          const raw = questionJSON();
          let node: ProseMirrorNode;
          try {
            node = state.schema.nodeFromJSON(raw);
          } catch {
            return false;
          }
          if (!dispatch) return true;
          const transaction = state.tr.insert(position, node);
          dispatch(transaction.scrollIntoView());
          this.options.runtime.onQuestionMetaChange?.({
            client_id: String(raw.attrs?.client_id),
            patch: { type: questionTypeForControl(attrs.type)! },
          });
          return true;
        }

        const context = questionContextAt(state.doc, position);
        if (!context) return false;
        return commands.addQuestionOption(context.clientId);
      },

      addQuestionOption: (clientId) => ({ editor, state, dispatch }) => {
        if (typeof clientId !== 'string' || !clientId) return false;
        const context = questionContextById(state.doc, clientId);
        if (!context || !canEditQuestionOptions(editor, this.options.runtime, context)
          || context.node.childCount - 1 >= 26) return false;
        if (!dispatch) return true;
        const raw = optionJSON();
        while (findQuestionOption(state.doc, String(raw.attrs?.option_id))) raw.attrs!.option_id = nanoid();
        const position = context.pos + context.node.nodeSize - 1;
        const transaction = state.tr.insert(position, state.schema.nodeFromJSON(raw));
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + 2)));
        dispatch(transaction.setMeta(QUESTION_STRUCTURE_META, { kind: 'option-add', client_id: clientId }).scrollIntoView());
        return true;
      },

      removeQuestionOption: (optionId) => ({ editor, state, dispatch }) => {
        if (typeof optionId !== 'string' || !optionId) return false;
        const target = findQuestionOption(state.doc, optionId);
        const context = target && questionContextAt(state.doc, target.pos);
        if (!target || !context || !canEditQuestionOptions(editor, this.options.runtime, context)
          || context.node.childCount - 1 <= 2) return false;
        if (!dispatch) return true;
        const transaction = state.tr.delete(target.pos, target.pos + target.node.nodeSize);
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(target.pos), -1));
        dispatch(transaction.setMeta(QUESTION_STRUCTURE_META, { kind: 'option-remove', client_id: context.clientId }).scrollIntoView());
        return true;
      },

      moveQuestionOption: (optionId, toIndex) => ({ editor, state, dispatch }) => {
        const target = findQuestionOption(state.doc, optionId);
        const context = target && questionContextAt(state.doc, target.pos);
        if (!target || !context || !canEditQuestionOptions(editor, this.options.runtime, context)
          || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= context.node.childCount - 1) return false;
        const options: ProseMirrorNode[] = [];
        context.node.forEach((node) => { if (node.type.name === 'questionOption') options.push(node); });
        const fromIndex = options.findIndex((node) => node.attrs.option_id === optionId);
        if (fromIndex === toIndex) return false;
        if (!dispatch) return true;
        const transaction = state.tr.delete(target.pos, target.pos + target.node.nodeSize);
        const remaining = options.filter((_, index) => index !== fromIndex);
        const position = context.pos + 1 + context.node.firstChild!.nodeSize
          + remaining.slice(0, toIndex).reduce((size, node) => size + node.nodeSize, 0);
        transaction.insert(position, target.node);
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + 2)));
        dispatch(transaction.setMeta(QUESTION_STRUCTURE_META, { kind: 'option-move', client_id: context.clientId, option_id: optionId }).scrollIntoView());
        return true;
      },

      setQuestionOptionChecked: (optionId, checked) => ({ editor, state, dispatch }) => {
        if (!isEditorMutationAllowed(editor) || typeof optionId !== 'string' || !optionId) return false;
        const target = findQuestionOption(state.doc, optionId);
        if (!target) return false;
        const context = questionContextAt(state.doc, target.pos);
        if (!context) return false;
        const meta = this.options.runtime.getQuestionMeta?.(context.clientId);
        if (!meta) return false;

        const optionPositions: Array<{ node: ProseMirrorNode; pos: number }> = [];
        context.node.forEach((child, offset) => {
          if (child.type.name === 'questionOption') {
            optionPositions.push({ node: child, pos: context.pos + 1 + offset });
          }
        });
        if (!optionPositions.some(({ node }) => node.attrs.option_id === optionId)) return false;

        const transaction = state.tr;
        let changed = false;
        optionPositions.forEach(({ node, pos }) => {
          const isTarget = node.attrs.option_id === optionId;
          const nextChecked = isTarget
            ? checked
            : ((meta.type === 'single' || meta.type === 'judgment') && checked ? false : node.attrs.checked);
          if (node.attrs.checked === nextChecked) return;
          transaction.setNodeMarkup(pos, undefined, { ...node.attrs, checked: nextChecked });
          changed = true;
        });
        if (!changed || !dispatch) return changed;
        dispatch(transaction);
        return true;
      },
    };
  },
});

export function createQuestionNodes(runtime: QuestionNodeRuntime = {}): Extensions {
  const options = { runtime };
  return [
    QuestionDocument,
    QuestionBlock.configure(options),
    QuestionStem,
    QuestionOption.configure(options),
    QuestionCommands.configure(options),
    createQuestionEditingProtection(runtime),
  ];
}
