import { createUuid } from '../utils/uuid';
import { computed, ref } from 'vue';
import type { DesignerMode, PaperDesignerValue, SavePaperDraft } from '../components/question-designers/contracts';
import {
  abandonPaperSave, applyPaperSaveOutcome, beginPaperSave, changePaperValue,
  createPaperSaveState, failPaperSave, preflightPaper, validatePaperStructure,
} from '../components/question-designers/paper-designer-state';

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function createPaperDesignerController(options: {
  value: PaperDesignerValue;
  mode?: DesignerMode;
  saveDraft: SavePaperDraft;
  onChange?: (value: PaperDesignerValue) => void;
}) {
  const state = ref(createPaperSaveState(options.value));
  const initial = ref(copy(options.value));
  const mode = ref<DesignerMode>(options.mode || 'create');
  const error = ref('');
  const revision = ref(0);
  const value = computed(() => state.value.value);
  const dirty = computed(() => state.value.dirty);
  const saving = computed(() => state.value.phase === 'saving');
  const incomplete = computed(() => state.value.phase === 'incomplete');
  const canAbandon = computed(() => state.value.can_abandon);
  const locked = computed(() => mode.value === 'readonly' || state.value.phase !== 'editing');
  let baseline = JSON.stringify(options.value);
  let epoch = 0;

  function publish() { options.onChange?.(copy(value.value)); }
  function replace(next: PaperDesignerValue): boolean {
    if (JSON.stringify(next) === JSON.stringify(value.value)) return false;
    if (incomplete.value && !canAbandon.value) { error.value = '保存结果尚未确认，请继续保存查询原请求'; return false; }
    const issues = validatePaperStructure(next);
    if (issues.length) { error.value = issues[0]!.message; return false; }
    epoch += 1; revision.value += 1;
    state.value = createPaperSaveState(next); initial.value = copy(next); baseline = JSON.stringify(next); error.value = '';
    return true;
  }
  function change(next: PaperDesignerValue): boolean {
    if (locked.value) return false;
    try {
      const updated = changePaperValue(state.value, next);
      if (updated === state.value) return true;
      state.value = { ...updated, dirty: JSON.stringify(next) !== baseline };
      revision.value += 1; error.value = ''; publish(); return true;
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : '题目结构不完整'; return false;
    }
  }
  async function save(): Promise<boolean> {
    if (saving.value || mode.value === 'readonly') return false;
    const issues = preflightPaper(value.value);
    if (issues.length) { error.value = issues[0]!.message; return false; }
    const ticket = epoch;
    error.value = '';
    try {
      state.value = beginPaperSave(state.value, state.value.context?.request_id ?? createUuid());
      const context = { request_id: state.value.context!.request_id, intent: 'save' as const };
      const outcome = await options.saveDraft(copy(value.value), context);
      if (ticket !== epoch) return false;
      state.value = applyPaperSaveOutcome(state.value, outcome);
      revision.value += 1; publish();
      if (outcome.status === 'incomplete') { error.value = outcome.message; return false; }
      baseline = JSON.stringify(value.value); return true;
    } catch (failure) {
      if (ticket !== epoch) return false;
      error.value = failure instanceof Error ? failure.message : (failure as { message?: string })?.message || '保存失败，请重试';
      state.value = failPaperSave(state.value, error.value); return false;
    }
  }
  function abandonSave() {
    if (saving.value || mode.value === 'readonly' || !canAbandon.value) return;
    state.value = abandonPaperSave(state.value); error.value = ''; revision.value += 1;
  }
  async function requestClose(confirm: () => Promise<boolean>): Promise<boolean> {
    if (saving.value) return false;
    if (incomplete.value && !canAbandon.value) { error.value = '保存结果尚未确认，请继续保存查询原请求'; return false; }
    const ticket = epoch; const version = revision.value;
    if (dirty.value && !await confirm()) return false;
    return ticket === epoch && version === revision.value && !saving.value;
  }
  return { value, initial, mode, error, revision, dirty, saving, incomplete, canAbandon, locked,
    change, replace, save, abandonSave, requestClose, invalidate: () => { epoch += 1; revision.value += 1; } };
}
