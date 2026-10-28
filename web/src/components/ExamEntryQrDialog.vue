<template>
  <el-dialog :model-value="modelValue" title="考试入口二维码" width="440px" class="re-form-dialog exam-entry-qr-dialog" @update:model-value="emit('update:modelValue', $event)">
    <p class="exam-entry-qr-dialog__title">扫码进入考试列表</p>
    <div v-if="loading" v-loading="true" class="exam-entry-qr-dialog__loading" aria-label="正在生成二维码" />
    <el-alert v-else-if="error" :title="error" type="warning" :closable="false" />
    <template v-else-if="imageUrl">
      <img :src="imageUrl" alt="扫码进入考试列表" width="320" height="320" class="exam-entry-qr-dialog__image" />
      <p class="exam-entry-qr-dialog__url">{{ entryUrl }}</p>
    </template>
    <p class="exam-entry-qr-dialog__hint">所有试卷共用此入口。登录后选择考试，完成必要资料和实名后由学员点击开始；扫码不占考试次数。</p>
    <p class="exam-entry-qr-dialog__hint">撤回、重新发布或新增试卷无需更换此码，域名或入口路径变更时需重新下载。</p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button v-if="error && !configurationError" @click="generate">重试</el-button>
      <el-button type="primary" :disabled="loading || !imageUrl" @click="download">下载二维码</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { buildExamEntryUrl } from '../utils/exam-entry-url';

const props = defineProps<{ modelValue: boolean; baseUrl?: string }>();
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>();
const baseUrl = computed(() => props.baseUrl ?? import.meta.env.VITE_PUBLIC_H5_BASE_URL ?? '');
const loading = ref(false);
const error = ref('');
const configurationError = ref(false);
const entryUrl = ref('');
const imageUrl = ref('');
let operation = 0;

function clear() { operation += 1; loading.value = false; error.value = ''; entryUrl.value = ''; imageUrl.value = ''; }
async function generate() {
  clear(); configurationError.value = false;
  if (!props.modelValue) return;
  const current = operation;
  let url: string;
  try { url = buildExamEntryUrl(baseUrl.value); }
  catch (failure) { configurationError.value = true; error.value = failure instanceof Error ? failure.message : '请配置 VITE_PUBLIC_H5_BASE_URL'; return; }
  loading.value = true;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 320 });
    if (current !== operation || !props.modelValue) return;
    entryUrl.value = url;
    imageUrl.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch { if (current === operation && props.modelValue) error.value = '二维码生成失败，请重试'; }
  finally { if (current === operation) loading.value = false; }
}
function download() {
  if (!props.modelValue || loading.value || !imageUrl.value) return;
  const anchor = document.createElement('a');
  anchor.href = imageUrl.value; anchor.download = '考试入口二维码.svg';
  document.body.append(anchor); anchor.click(); anchor.remove();
}
watch(() => [props.modelValue, baseUrl.value] as const, () => { void generate(); }, { immediate: true, flush: 'sync' });
onDeactivated(clear);
onBeforeUnmount(clear);
</script>

<style scoped>
.exam-entry-qr-dialog__title { text-align:center; margin:0; font-size:16px; }
.exam-entry-qr-dialog__image { display:block; max-width:100%; height:auto; margin:8px auto; }
.exam-entry-qr-dialog__loading { height:320px; }
.exam-entry-qr-dialog__url { overflow-wrap:anywhere; text-align:center; font-size:12px; }
.exam-entry-qr-dialog__hint { color:var(--el-text-color-secondary); font-size:12px; line-height:1.6; margin:12px 0 0; }
</style>
