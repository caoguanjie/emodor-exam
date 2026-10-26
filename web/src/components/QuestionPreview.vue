<template>
  <div class="question-preview">
    <div class="question-preview__meta">
      <el-tag size="small">{{ typeLabel }}</el-tag>
      <el-tag size="small" type="info">{{ difficultyLabel }}</el-tag>
      <span v-if="showScore && question.score != null">{{ Number(question.score) }} 分</span>
    </div>
    <div class="question-preview__stem rich-content" v-html="rendered.stem" />
    <div class="question-preview__options">
      <div v-for="(option, index) in rendered.options" :key="option.key" class="question-preview__option">
        <span class="question-preview__key">{{ String.fromCharCode(65 + index) }}</span>
        <div class="rich-content" v-html="option.text" />
        <el-tag v-if="revealAnswer && rendered.correctIds.includes(option.key)" size="small" type="success">正确答案</el-tag>
      </div>
    </div>
    <section v-if="revealAnswer && rendered.analysis" class="question-preview__explanation">
      <strong>解析</strong>
      <div class="rich-content" v-html="rendered.analysis" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue';
import { resolvePcMedia, invalidatePcMedia } from '../services/media-content';
import { onMediaContextChange } from '../services/media-context';
import { normalizeQuestionContentV2, readonlyQuestionDocToHtml, sanitizeQuestionHtmlForPreview, type QuestionContentFields, type QuestionOption, type QuestionType } from '../api/training-types';
import { questionRichDocToFormHtml, toQuestionFormValue } from '../utils/question-form-content';
import type { QuestionContentV3 } from '../api/question-document-types';

const props = withDefaults(defineProps<{
  question: QuestionContentFields & {
    type?: QuestionType;
    difficulty?: string | null;
    stem?: string;
    options?: QuestionOption[];
    answer?: number[];
    analysis?: string | null;
    score?: number | null;
  };
  revealAnswer?: boolean;
  showScore?: boolean;
}>(), { revealAnswer: true, showScore: false });
const emit = defineEmits<{ ready: [result: { ok: boolean }] }>();

const rendered = reactive<{ stem: string; options: QuestionOption[]; analysis: string; correctIds: string[] }>({
  stem: '', options: [], analysis: '', correctIds: [],
});
let renderSerial = 0;

const typeLabel = computed(() => ({ single: '单选题', multiple: '多选题', judgment: '判断题' } as Record<string, string>)[props.question.type || ''] || '题目');
const difficultyLabel = computed(() => ({ easy: '简单', medium: '中级', hard: '困难' } as Record<string, string>)[props.question.difficulty || ''] || '难度未知');

async function decodeMediaUrl(url: string): Promise<void> {
  if (typeof Image === 'undefined') return;
  const image = new Image();
  if (typeof image.decode === 'function') {
    image.src = url;
    await image.decode();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image decode failed'));
    image.src = url;
  });
}

async function hydrate(html: string | null | undefined, serial: number, restricted = false): Promise<{ html: string; ok: boolean }> {
  const safeHtml = restricted ? html || '' : sanitizeQuestionHtmlForPreview(html);
  if (!safeHtml || typeof document === 'undefined') return { html: safeHtml, ok: true };
  const template = document.createElement('template');
  template.innerHTML = safeHtml;
  const images = [...template.content.querySelectorAll<HTMLImageElement>('img[data-media-id]')];
  let ok = true;
  await Promise.all(images.map(async (node) => {
    const assetId = node.dataset.mediaId || '';
    if (!/^[1-9]\d*$/.test(assetId)) {
      node.remove();
      ok = false;
      return;
    }
    try {
      const ticket = await resolvePcMedia(assetId);
      if (serial !== renderSerial) return;
      const url = ticket.content_url;
      try {
        await decodeMediaUrl(url);
      } catch {
        if (serial !== renderSerial) return;
        invalidatePcMedia(assetId);
        ok = false;
        const fallback = document.createElement('span');
        fallback.className = 'question-preview__missing-media';
        fallback.textContent = `图片 ${assetId} 暂不可预览`;
        node.replaceWith(fallback);
        return;
      }
      if (serial !== renderSerial) return;
      node.src = url;
      node.removeAttribute('data-media-id');
      node.loading = 'lazy';
    } catch {
      if (serial !== renderSerial) return;
      ok = false;
      const fallback = document.createElement('span');
      fallback.className = 'question-preview__missing-media';
      fallback.textContent = `图片 ${assetId} 暂不可预览`;
      node.replaceWith(fallback);
    }
  }));
  return { html: template.innerHTML, ok };
}

async function renderQuestion() {
  const serial = ++renderSerial;
  let question = props.question;
  const restricted = question.content_schema_version === 2 || question.content_schema_version === 3;
  try {
    if (question.content_schema_version === 3) {
      const content = question.content_json as Partial<QuestionContentV3> | null;
      if (!content || typeof content !== 'object' || !Array.isArray(content.options)) throw new Error('schema 3 preview content is incomplete');
      const ids = content.options.map((option) => option?.id);
      if (ids.length < 2 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
        throw new Error('schema 3 preview option ids are invalid');
      }
      const full = Object.hasOwn(content, 'analysis') && Array.isArray(content.answer_option_ids);
      if (props.revealAnswer && !full) throw new Error('answer preview content is incomplete');
      const fields = full
        ? toQuestionFormValue({ ...(content as QuestionContentV3), schema: 3 })
        : {
            stem: questionRichDocToFormHtml(content.stem as QuestionContentV3['stem']),
            options: content.options.map((option) => ({ key: option.id!, text: questionRichDocToFormHtml(option.content!) })),
            analysis: null,
            answer: [],
          };
      question = { ...question, ...fields };
    } else if (restricted) {
      const content = normalizeQuestionContentV2(question.content_json);
      question = {
        ...question, stem: readonlyQuestionDocToHtml(content.stem),
        options: content.options.map((option) => ({ key: option.id, text: readonlyQuestionDocToHtml(option.content) })),
        analysis: content.analysis ? readonlyQuestionDocToHtml(content.analysis) : null,
        answer: content.options.flatMap((option, index) => content.answer_option_ids.includes(option.id) ? [index] : []),
      };
    }
  } catch {
    rendered.stem = '题目内容格式不正确，暂不可预览';
    rendered.options = [];
    rendered.analysis = '';
    rendered.correctIds = [];
    emit('ready', { ok: false });
    return;
  }
  const [stem, options, analysis] = await Promise.all([
    hydrate(question.stem, serial, restricted),
    Promise.all((question.options || []).map(async (option, index) => ({
      key: option.key || String.fromCharCode(65 + index), text: await hydrate(option.text, serial, restricted),
    }))),
    hydrate(props.revealAnswer ? question.analysis : null, serial, restricted),
  ]);
  if (serial !== renderSerial) return;
  rendered.stem = stem.html;
  rendered.options = options.map((option) => ({ key: option.key, text: option.text.html }));
  rendered.analysis = analysis.html;
  rendered.correctIds = (question.answer || []).flatMap((index) => question.options?.[index] ? [question.options[index].key] : []);
  emit('ready', { ok: stem.ok && options.every((option) => option.text.ok) && analysis.ok });
}

watch([() => props.question, () => props.revealAnswer], () => { void renderQuestion(); }, { deep: true, immediate: true });
const unsubscribeContext = onMediaContextChange(() => {
  renderSerial += 1;
  rendered.stem = ''; rendered.options = []; rendered.analysis = ''; rendered.correctIds = [];
});
onBeforeUnmount(() => {
  unsubscribeContext();
  renderSerial += 1;
});
</script>

<style scoped>
.question-preview { display: grid; gap: 14px; }
.question-preview__meta { display: flex; align-items: center; gap: 8px; color: #606266; }
.question-preview__stem { font-size: 16px; font-weight: 600; line-height: 1.7; }
.question-preview__options { display: grid; gap: 9px; }
.question-preview__option { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid #e4e7ed; border-radius: 8px; }
.question-preview__key { flex: 0 0 26px; height: 26px; border-radius: 50%; background: #eef4ff; color: #337ecc; display: grid; place-items: center; font-weight: 600; }
.question-preview__option .rich-content { flex: 1; min-width: 0; }
.question-preview__explanation { padding: 12px; border-radius: 8px; background: #f5f7fa; }
.rich-content :deep(p) { margin: 0 0 8px; }
.rich-content :deep(p:last-child) { margin-bottom: 0; }
.rich-content :deep(img) { display: block; max-width: 100%; max-height: 360px; margin: 10px 0; border-radius: 6px; }
.rich-content { min-width: 0; overflow-x: auto; }
.rich-content :deep(table) { border-collapse: collapse; min-width: 100%; }
.rich-content :deep(td), .rich-content :deep(th) { border: 1px solid #dcdfe6; padding: 6px 8px; }
.rich-content :deep(blockquote) { border-left: 3px solid #dcdfe6; margin: 8px 0; padding-left: 12px; }
.rich-content :deep(pre) { white-space: pre-wrap; padding: 8px; background: #f5f7fa; }
.rich-content :deep(.question-preview__missing-media) { color: #c45656; }
</style>
