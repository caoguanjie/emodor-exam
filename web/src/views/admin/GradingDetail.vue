<template>
  <div>
    <div class="toolbar detail-toolbar">
      <el-button text @click="$router.push('/admin/grading')"><el-icon><ArrowLeft /></el-icon>返回阅卷队列</el-button>
      <div class="grow" />
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button :disabled="!result" @click="printResult">打印 / 导出 PDF</el-button>
    </div>

    <div v-if="result" class="summary page-card">
      <div><span class="muted">记录 ID</span><b>{{ result.record_id }}</b></div>
      <div><span class="muted">状态</span><el-tag :type="result.grading_state === 'finalized' ? 'success' : 'warning'">{{ result.grading_state === 'finalized' ? '已完成批改' : '待人工批改' }}</el-tag></div>
      <div><span class="muted">总分</span><b>{{ result.score ?? '尚未汇总' }}</b></div>
      <div><span class="muted">交卷时间</span><b>{{ formatDateTime(result.submitted_at) }}</b></div>
    </div>

    <div v-loading="loading">
      <section v-for="(item, index) in result?.items || []" :key="item.item_id" class="question-card page-card">
        <header><strong>第 {{ index + 1 }} 题</strong><span>{{ item.score }} 分</span><el-tag v-if="item.type === 'image'" size="small">图片作答</el-tag></header>
        <QuestionPreview :question="previewQuestion(item)" :reveal-answer="true" />

        <template v-if="item.type === 'image'">
          <div class="answer-title">学员答案</div>
          <div v-if="item.answer?.asset_ids?.length" class="answer-images">
            <el-image v-for="assetId in item.answer.asset_ids" :key="assetId" class="answer-image" fit="contain"
              :src="imageUrls[assetId]" :preview-src-list="previewUrls(item.answer.asset_ids)" preview-teleported>
              <template #error><div class="image-error">图片 {{ assetId }} 无法读取</div></template>
            </el-image>
          </div>
          <el-alert v-else type="info" :closable="false" title="本题未作答，交卷时已按 0 分结算，不产生人工批改任务。" />

          <el-form v-if="item.answer?.asset_ids?.length" class="score-form" label-width="80px" :disabled="finalized || savingItem === item.item_id">
            <el-form-item label="本题满分"><span>{{ item.score }} 分</span></el-form-item>
            <el-form-item label="得分">
              <el-input-number v-model="forms[item.item_id].scoreCents" :min="0" :max="Math.round(item.score * 100)" :step="1" />
              <span class="cents-note">整数分值（{{ forms[item.item_id].scoreCents / 100 }} 分）</span>
            </el-form-item>
            <el-form-item label="评语"><el-input v-model="forms[item.item_id].comment" type="textarea" :rows="3" maxlength="2000" show-word-limit /></el-form-item>
            <el-form-item>
              <el-button v-if="!finalized" type="primary" :loading="savingItem === item.item_id" @click="save(item)">{{ item.gained_score === null ? '提交评分' : '更正评分' }}</el-button>
              <span v-else class="muted">最终结算后评分只读</span>
              <span class="version">评分版本 {{ item.grading_version }}</span>
            </el-form-item>
          </el-form>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import http, { ApiError } from '../../api/http';
import { getMediaImageContent } from '../../api/media';
import type { FinalResult, FinalResultItem } from '../../api/training-types';
import QuestionPreview from '../../components/QuestionPreview.vue';
import { formatDateTime } from '../../utils/format';

const route = useRoute();
const result = ref<FinalResult | null>(null);
const finalized = computed(() => result.value?.grading_state === 'finalized');
const loading = ref(false);
const savingItem = ref<string | null>(null);
const forms = reactive<Record<string, { scoreCents: number; comment: string }>>({});
const imageUrls = reactive<Record<string, string>>({});
const objectUrls = new Set<string>();
let loadSerial = 0;

function clearImages() { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); for (const key of Object.keys(imageUrls)) delete imageUrls[key]; }
function previewQuestion(item: FinalResultItem) { return { ...item, answer: item.correct_answer || [] }; }
function previewUrls(assetIds: string[]) { return assetIds.map((id) => imageUrls[id]).filter(Boolean); }
function initializeForms(data: FinalResult) {
  for (const item of data.items) {
    if (item.type !== 'image') continue;
    forms[item.item_id] = { scoreCents: Math.round(Number(item.gained_score || 0) * 100), comment: item.comment || '' };
  }
}
async function hydrateAnswerImages(data: FinalResult, serial: number) {
  clearImages();
  const ids = [...new Set(data.items.flatMap((item) => item.answer?.asset_ids || []))];
  await Promise.all(ids.map(async (id) => {
    try {
      const blob = await getMediaImageContent(id);
      if (serial !== loadSerial) return;
      const url = URL.createObjectURL(blob);
      objectUrls.add(url);
      imageUrls[id] = url;
    } catch { if (serial === loadSerial) imageUrls[id] = ''; }
  }));
}
async function load() {
  const serial = ++loadSerial;
  loading.value = true;
  try {
    const data = await http.get(`/admin/exam-records/${route.params.id}/result`) as FinalResult;
    if (serial !== loadSerial) return;
    result.value = data;
    initializeForms(data);
    await hydrateAnswerImages(data, serial);
  } finally { if (serial === loadSerial) loading.value = false; }
}
async function save(item: FinalResultItem) {
  const form = forms[item.item_id];
  if (!result.value || !form) return;
  savingItem.value = item.item_id;
  try {
    const data = await http.put(`/admin/exam-records/${result.value.record_id}/grades/${item.item_id}`, {
      score_cents: form.scoreCents,
      comment: form.comment,
      expected_version: item.grading_version,
    }) as FinalResult;
    result.value = data;
    initializeForms(data);
    ElMessage.success(data.grading_state === 'finalized' ? '全部图片题已评分，最终成绩已结算' : '评分已保存');
  } catch (error) {
    if (error instanceof ApiError && error.code === 40905) {
      ElMessage.warning('评分已被更新，已刷新最新版本');
      await load();
    }
  } finally { savingItem.value = null; }
}
function printResult() { window.print(); }

onMounted(load);
onBeforeUnmount(() => { loadSerial += 1; clearImages(); });
</script>

<style scoped>
.detail-toolbar { margin-bottom: 14px; }.grow { flex: 1; }.summary { display: flex; gap: 36px; align-items: center; margin-bottom: 14px; }.summary>div { display: grid; gap: 5px; }.muted { color: var(--re-text-3); }.question-card { margin-bottom: 14px; }.question-card header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }.answer-title { margin: 18px 0 10px; font-weight: 600; }.answer-images { display: flex; flex-wrap: wrap; gap: 12px; }.answer-image { width: 180px; height: 140px; border: 1px solid var(--re-border); border-radius: 8px; background: #f5f7fa; }.image-error { display: grid; place-items: center; height: 100%; padding: 10px; color: var(--re-text-3); }.score-form { margin-top: 18px; max-width: 720px; }.cents-note,.version { margin-left: 12px; color: var(--re-text-3); font-size: 12px; }
@media print { .detail-toolbar,.score-form button { display:none!important; }.page-card { box-shadow:none; break-inside:avoid; } }
</style>
