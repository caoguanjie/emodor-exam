<template>
  <div class="ai-config-page">
    <el-alert v-if="loadError" class="ai-load-error" :title="loadError" type="error" :closable="false" show-icon>
      <template #default>
        <el-button link type="primary" :loading="initializing" @click="loadConfig">重新加载</el-button>
      </template>
    </el-alert>
    <div class="ai-config-layout">
      <section class="ai-panel ai-connection" aria-labelledby="ai-connection-title">
        <header class="ai-panel-header">
          <span class="ai-panel-icon" aria-hidden="true"><el-icon><Cpu /></el-icon></span>
          <div>
            <h2 id="ai-connection-title">连接配置</h2>
            <p>设置 AI 服务的访问地址与模型。</p>
          </div>
          <span v-if="!auth.can('ai_config:write')" class="ai-readonly">仅查看</span>
        </header>

        <el-form v-loading="initializing" label-position="top" class="ai-config-form">
          <el-form-item label="服务地址">
            <template #label><span class="ai-field-label">服务地址 <span>Base URL</span></span></template>
            <el-input v-model="form.base_url" :disabled="!auth.can('ai_config:write') || configLocked" placeholder="如 https://open.bigmodel.cn/api/paas/v4" />
            <p class="ai-field-hint">填写服务商提供的 API 基础地址。</p>
          </el-form-item>
          <el-form-item label="访问密钥">
            <template #label><span class="ai-field-label">访问密钥 <span>API Key</span></span></template>
            <el-input v-model="form.api_key" :disabled="!auth.can('ai_config:write') || configLocked" :placeholder="masked ? `已保存：${masked}（留空保持不变）` : '请输入 api_key'" show-password autocomplete="new-password" />
            <p class="ai-field-hint">{{ masked ? '已保存密钥；留空可继续使用，填写新密钥后保存即可替换。' : '填写服务商提供的密钥，保存后将隐藏显示。' }}</p>
          </el-form-item>
          <el-form-item label="模型名称">
            <template #label><span class="ai-field-label">模型名称 <span>Model</span></span></template>
            <el-input v-model="form.model" :disabled="!auth.can('ai_config:write') || configLocked" placeholder="如 glm-4-flash / deepseek-chat / qwen-plus" />
            <p class="ai-field-hint">使用服务商支持的完整模型名称。</p>
          </el-form-item>
        </el-form>

        <footer class="ai-config-footer">
          <span v-if="dirty" class="ai-save-hint ai-save-hint--dirty"><i aria-hidden="true" />有未保存的修改</span>
          <span v-else class="ai-save-hint">配置保存后生效</span>
          <el-button v-if="auth.can('ai_config:write')" type="primary" :disabled="configLocked" @click="onSave">保存配置</el-button>
        </footer>
      </section>

      <section class="ai-panel ai-verification" aria-labelledby="ai-verification-title">
        <header class="ai-verification-header">
          <span class="ai-section-caption">完成配置后</span>
          <h2 id="ai-verification-title">验证服务是否可用</h2>
          <p>以下测试使用已保存的配置。</p>
        </header>

        <div class="ai-test-item">
          <span class="ai-test-icon" aria-hidden="true"><el-icon><Monitor /></el-icon></span>
          <div class="ai-test-content">
            <h3>连通性测试</h3>
            <p>检查服务连接与模型响应是否正常。</p>
            <el-button v-if="auth.can('ai_config:write')" :disabled="configLocked" @click="onTest" :loading="testing">连通性测试<el-icon class="ai-button-arrow" aria-hidden="true"><Right /></el-icon></el-button>
          </div>
        </div>
        <div class="ai-test-item">
          <span class="ai-test-icon ai-test-icon--vision" aria-hidden="true"><el-icon><Picture /></el-icon></span>
          <div class="ai-test-content">
            <h3>多模态测试</h3>
            <p>检查当前模型是否支持图片输入。</p>
            <el-button v-if="auth.can('ai_config:write')" :disabled="configLocked" @click="onTestVision" :loading="testingVision">多模态测试<el-icon class="ai-button-arrow" aria-hidden="true"><Right /></el-icon></el-button>
          </div>
        </div>

        <div class="ai-test-note"><span class="ai-note-mark" aria-hidden="true">i</span><p>{{ dirty ? '当前有未保存的修改，请先保存配置，再验证新的连接。' : '修改服务地址、密钥或模型后，建议重新测试。' }}</p></div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Cpu, Monitor, Picture, Right } from '@element-plus/icons-vue';
import http from '../../api/http';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const form = reactive<any>({ base_url: '', api_key: '', model: '' });
const masked = ref('');
const testing = ref(false);
const testingVision = ref(false);
const dirty = ref(false);
const formBaseline = ref(JSON.stringify(form));
const canReadConfig = auth.can('ai_config:read');
const initializing = ref(canReadConfig);
const loadError = ref('');
const configLocked = computed(() => initializing.value || !!loadError.value);

function serializeForm() { return JSON.stringify(form); }
function replaceForm(value: any) { Object.assign(form, value); }
function captureBaseline() {
  formBaseline.value = serializeForm();
  dirty.value = false;
}
function discardDraft() {
  replaceForm(JSON.parse(formBaseline.value));
  dirty.value = false;
}

const unsaved = useUnsavedChanges(dirty, { onDiscard: discardDraft });
watch(() => serializeForm(), () => {
  dirty.value = serializeForm() !== formBaseline.value;
}, { flush: 'sync' });

function applyMaskedConfig(d: any) {
  form.base_url = d.base_url || '';
  form.model = d.model || '';
  masked.value = d.api_key_masked || '';
}

async function loadConfig() {
  // ai_config:write intentionally does not imply read: writer-only roles get
  // a blank form and may use the masked PUT response after saving.
  if (!canReadConfig) return;
  initializing.value = true;
  loadError.value = '';
  try {
    applyMaskedConfig(await http.get('/ai/config'));
    form.api_key = '';
    captureBaseline();
  } catch {
    loadError.value = 'AI 配置加载失败，请重试';
  } finally {
    initializing.value = false;
  }
}

onMounted(loadConfig);

async function onSave() {
  const saved: any = await http.put('/ai/config', form);
  applyMaskedConfig(saved);
  ElMessage.success('AI 服务配置已保存');
  form.api_key = '';
  captureBaseline();
  unsaved.markClean();
}

async function onTest() {
  testing.value = true;
  try {
    await http.post('/ai/config/test');
    ElMessage.success('连通性测试通过');
  } finally {
    testing.value = false;
  }
}

async function onTestVision() {
  testingVision.value = true;
  try {
    await http.post('/ai/config/test-vision');
    ElMessage.success('多模态测试通过，当前模型支持图片输入');
  } finally {
    testingVision.value = false;
  }
}
</script>

<style scoped>
.ai-config-page.page-enter { flex:0 0 auto; }
.ai-config-page { width:100%; max-width:1280px; margin:12px auto 0; min-width:0; }
.ai-load-error { margin-bottom:20px; }
.ai-config-layout { display:grid; grid-template-columns:minmax(0, 1.65fr) minmax(300px, 1fr); gap:24px; align-items:start; }
.ai-panel { min-width:0; background:var(--re-surface); border:1px solid var(--re-border); border-radius:12px; box-shadow:var(--re-shadow-card); overflow:hidden; }
.ai-panel-header { display:flex; align-items:center; gap:14px; padding:26px 28px; border-bottom:1px solid var(--re-border); }
.ai-panel-icon { display:flex; flex:none; align-items:center; justify-content:center; width:44px; height:44px; border:1px solid var(--el-color-primary-light-8); border-radius:12px; background:var(--el-color-primary-light-9); color:var(--re-primary); font-size:23px; }
.ai-panel h2 { margin:0; font-size:18px; font-weight:600; line-height:1.5; color:var(--re-text); }
.ai-panel-header p, .ai-verification-header p { margin:5px 0 0; color:var(--re-text-3); font-size:13px; line-height:1.6; }
.ai-readonly { margin-left:auto; flex:none; padding:4px 10px; border-radius:6px; background:var(--re-bg); color:var(--re-text-2); font-size:12px; }
.ai-config-form { padding:26px 28px 4px; }
.ai-config-form :deep(.el-form-item) { margin-bottom:24px; }
.ai-config-form :deep(.el-form-item__label) { height:auto; margin-bottom:9px; padding:0; line-height:1.5; }
.ai-config-form :deep(.el-input__wrapper) { min-height:42px; box-sizing:border-box; padding:1px 13px; }
.ai-field-label { display:inline-flex; align-items:baseline; gap:10px; color:var(--re-text); font-size:14px; font-weight:500; }
.ai-field-label > span { color:var(--re-text-3); font-size:12px; font-weight:400; }
.ai-field-hint { width:100%; margin:8px 0 0; color:var(--re-text-3); font-size:12px; line-height:1.6; }
.ai-config-footer { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:72px; padding:16px 28px; box-sizing:border-box; border-top:1px solid var(--re-border); background:var(--el-fill-color-lighter); }
.ai-config-footer .el-button { min-width:112px; height:38px; }
.ai-save-hint { display:inline-flex; align-items:center; gap:7px; color:var(--re-text-3); font-size:12px; line-height:1.5; }
.ai-save-hint--dirty { color:var(--re-warning); }
.ai-save-hint i { width:6px; height:6px; border-radius:50%; background:currentColor; }
.ai-verification { padding:28px; box-sizing:border-box; }
.ai-section-caption { display:block; margin-bottom:8px; color:var(--re-primary); font-size:12px; font-weight:500; }
.ai-verification-header { padding-bottom:24px; border-bottom:1px solid var(--re-border); }
.ai-test-item { display:flex; align-items:flex-start; gap:14px; padding:24px 0; }
.ai-test-item + .ai-test-item { border-top:1px solid var(--re-border); }
.ai-test-icon { display:flex; flex:none; align-items:center; justify-content:center; width:38px; height:38px; border-radius:10px; background:var(--el-color-primary-light-9); color:var(--re-primary); font-size:19px; }
.ai-test-icon--vision { background:var(--el-color-success-light-9); color:var(--re-success); }
.ai-test-content { min-width:0; }
.ai-test-content h3 { margin:1px 0 7px; font-size:14px; font-weight:600; line-height:1.5; }
.ai-test-content p { margin:0 0 14px; color:var(--re-text-3); font-size:12px; line-height:1.7; }
.ai-test-content .el-button { height:34px; padding:8px 12px; }
.ai-test-content .el-button:not(.is-disabled) { color:var(--re-text-2); }
.ai-test-content .el-button:hover:not(:disabled) { color:var(--re-primary); }
.ai-button-arrow { margin-left:16px; font-size:13px; }
.ai-test-note { display:flex; align-items:flex-start; gap:9px; padding:12px 14px; border-radius:8px; background:var(--re-bg); color:var(--re-text-2); }
.ai-note-mark { display:inline-flex; flex:none; align-items:center; justify-content:center; width:14px; height:14px; margin-top:2px; border:1px solid var(--re-text-3); border-radius:50%; font:11px Georgia, serif; }
.ai-test-note p { margin:0; font-size:12px; line-height:1.7; }
@media (max-width:1050px) {
  .ai-config-layout { grid-template-columns:minmax(0, 1.4fr) minmax(280px, 1fr); gap:16px; }
  .ai-panel-header, .ai-config-footer { padding-left:22px; padding-right:22px; }
  .ai-config-form { padding-left:22px; padding-right:22px; }
  .ai-verification { padding:22px; }
}
@media (max-width:800px) {
  .ai-config-page { margin-top:0; }
  .ai-config-layout { grid-template-columns:minmax(0, 1fr); }
}
@media (max-width:480px) {
  .ai-panel-header, .ai-config-footer { padding-left:18px; padding-right:18px; }
  .ai-config-form { padding-left:18px; padding-right:18px; }
  .ai-verification { padding:20px 18px; }
}
</style>
