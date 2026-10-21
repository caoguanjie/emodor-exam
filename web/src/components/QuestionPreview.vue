<template>
  <div class="question-preview">
    <div class="question-preview__meta">
      <el-tag size="small">{{ typeLabel }}</el-tag>
      <el-tag size="small" type="info">{{ difficultyLabel }}</el-tag>
      <span>{{ Number(question.score || 0) }} 分</span>
    </div>
    <div class="question-preview__stem rich-content" v-html="rendered.stem" />
    <div v-if="question.type !== 'image'" class="question-preview__options">
      <div v-for="(option, index) in rendered.options" :key="index" class="question-preview__option">
        <span class="question-preview__key">{{ option.key || String.fromCharCode(65 + index) }}</span>
        <div class="rich-content" v-html="option.text" />
        <el-tag v-if="revealAnswer && (question.answer || []).includes(index)" size="small" type="success">正确答案</el-tag>
      </div>
    </div>
    <el-alert v-else type="info" :closable="false" title="图片作答题：考生提交受控图片，由管理员按评分参考逐题评分。" />
    <section v-if="revealAnswer && rendered.analysis" class="question-preview__explanation">
      <strong>解析</strong>
      <div class="rich-content" v-html="rendered.analysis" />
    </section>
    <section v-if="revealAnswer && question.type === 'image' && rendered.rubric" class="question-preview__explanation">
      <strong>评分参考</strong>
      <div class="rich-content" v-html="rendered.rubric" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue';
import { getMediaImageContent } from '../api/media';
import { sanitizeQuestionHtmlForPreview, type QuestionOption, type QuestionType } from '../api/training-types';

const props = withDefaults(defineProps<{
  question: {
    type?: QuestionType;
    difficulty?: string | null;
    stem?: string;
    options?: QuestionOption[];
    answer?: number[];
    analysis?: string | null;
    rubric?: string | null;
    score?: number;
  };
  revealAnswer?: boolean;
}>(), { revealAnswer: true });

const rendered = reactive<{ stem: string; options: QuestionOption[]; analysis: string; rubric: string }>({
  stem: '', options: [], analysis: '', rubric: '',
});
const objectUrls = new Set<string>();
let renderSerial = 0;

const typeLabel = computed(() => ({ single: '单选题', multiple: '多选题', judgment: '判断题', image: '图片作答题' } as Record<string, string>)[props.question.type || ''] || '题目');
const difficultyLabel = computed(() => ({ easy: '初级', medium: '中级', hard: '高级' } as Record<string, string>)[props.question.difficulty || ''] || '难度未知');

function clearObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

async function hydrate(html: string | null | undefined, serial: number): Promise<string> {
  const safeHtml = sanitizeQuestionHtmlForPreview(html);
  if (!safeHtml || typeof document === 'undefined') return safeHtml;
  const template = document.createElement('template');
  template.innerHTML = safeHtml;
  const images = [...template.content.querySelectorAll<HTMLImageElement>('img[data-media-id]')];
  await Promise.all(images.map(async (node) => {
    const assetId = node.dataset.mediaId || '';
    if (!/^[1-9]\d*$/.test(assetId)) {
      node.remove();
      return;
    }
    try {
      const blob = await getMediaImageContent(assetId);
      if (serial !== renderSerial) return;
      const url = URL.createObjectURL(blob);
      objectUrls.add(url);
      node.src = url;
      node.removeAttribute('data-media-id');
      node.loading = 'lazy';
    } catch {
      const fallback = document.createElement('span');
      fallback.className = 'question-preview__missing-media';
      fallback.textContent = `图片 ${assetId} 暂不可预览`;
      node.replaceWith(fallback);
    }
  }));
  return template.innerHTML;
}

async function renderQuestion() {
  const serial = ++renderSerial;
  clearObjectUrls();
  const [stem, options, analysis, rubric] = await Promise.all([
    hydrate(props.question.stem, serial),
    Promise.all((props.question.options || []).map(async (option, index) => ({
      key: option.key || String.fromCharCode(65 + index), text: await hydrate(option.text, serial),
    }))),
    hydrate(props.question.analysis, serial),
    hydrate(props.question.rubric, serial),
  ]);
  if (serial !== renderSerial) return;
  rendered.stem = stem;
  rendered.options = options;
  rendered.analysis = analysis;
  rendered.rubric = rubric;
}

watch(() => props.question, () => { void renderQuestion(); }, { deep: true, immediate: true });
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
