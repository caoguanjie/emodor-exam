<template>
  <div class="question-preview">
    <div class="question-preview__meta">
      <el-tag size="small">{{ typeLabel }}</el-tag>
      <el-tag size="small" type="info">{{ difficultyLabel }}</el-tag>
      <span>{{ Number(question.score || 0) }} 分</span>
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
import { getMediaImageContent } from '../api/media';
import { normalizeQuestionContentV2, readonlyQuestionDocToHtml, sanitizeQuestionHtmlForPreview, type QuestionContentFields, type QuestionOption, type QuestionType } from '../api/training-types';

const props = withDefaults(defineProps<{
  question: QuestionContentFields & {
    type?: QuestionType;
    difficulty?: string | null;
    stem?: string;
    options?: QuestionOption[];
    answer?: number[];
    analysis?: string | null;
    score?: number;
  };
  revealAnswer?: boolean;
}>(), { revealAnswer: true });
const emit = defineEmits<{ ready: [result: { ok: boolean }] }>();

const rendered = reactive<{ stem: string; options: QuestionOption[]; analysis: string; correctIds: string[] }>({
  stem: '', options: [], analysis: '', correctIds: [],
});
const objectUrls = new Set<string>();
let renderSerial = 0;

const typeLabel = computed(() => ({ single: '单选题', multiple: '多选题', judgment: '判断题' } as Record<string, string>)[props.question.type || ''] || '题目');
const difficultyLabel = computed(() => ({ easy: '初级', medium: '中级', hard: '高级' } as Record<string, string>)[props.question.difficulty || ''] || '难度未知');

function clearObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function releaseObjectUrl(url: string) {
  if (!objectUrls.delete(url)) return;
  URL.revokeObjectURL(url);
}

async function decodeObjectUrl(url: string): Promise<void> {
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
      const blob = await getMediaImageContent(assetId);
      if (serial !== renderSerial) return;
      const url = URL.createObjectURL(blob);
      objectUrls.add(url);
      try {
        await decodeObjectUrl(url);
      } catch {
        if (serial !== renderSerial) return;
        releaseObjectUrl(url);
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
  clearObjectUrls();
  let question = props.question;
  const restricted = question.content_schema_version === 2;
  try {
    if (restricted) {
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
onBeforeUnmount(() => {
  renderSerial += 1;
  clearObjectUrls();
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
.rich-content :deep(.question-preview__missing-media) { color: #c45656; }
</style>
