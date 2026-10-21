<template>
  <div class="page-card" style="max-width:640px">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>AI 服务配置</h2>
      <p class="desc">
        兼容智谱 GLM、DeepSeek、通义千问等 OpenAI 兼容端点。api_key 以 AES-256-GCM 加密保存于应用数据目录配置文件（不落业务库），
        界面仅掩码回显；切换服务商 = 改配置，无需改代码、无需停机。扫描版 PDF 会自动按页面发送给支持视觉输入的模型，保存后可单独测试视觉输入。
      </p>
    </div>
    <el-form label-width="110px">
      <el-form-item label="base_url">
        <el-input v-model="form.base_url" :disabled="!auth.can('ai:write')" placeholder="如 https://open.bigmodel.cn/api/paas/v4" />
      </el-form-item>
      <el-form-item label="api_key">
        <el-input v-model="form.api_key" :disabled="!auth.can('ai:write')" :placeholder="masked ? `已保存：${masked}（留空保持不变）` : '请输入 api_key'" show-password />
      </el-form-item>
      <el-form-item label="model">
        <el-input v-model="form.model" :disabled="!auth.can('ai:write')" placeholder="如 glm-4-flash / deepseek-chat / qwen-plus" />
      </el-form-item>
      <el-form-item>
        <el-button v-if="auth.can('ai:write')" type="primary" @click="onSave">保存配置</el-button>
        <el-button v-if="auth.can('ai:write')" @click="onTest" :loading="testing">连通性测试</el-button>
        <el-button v-if="auth.can('ai:write')" @click="onTestVision" :loading="testingVision">多模态测试</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const form = reactive<any>({ base_url: '', api_key: '', model: '' });
const masked = ref('');
const testing = ref(false);
const testingVision = ref(false);

onMounted(async () => {
  const d: any = await http.get('/ai/config');
  form.base_url = d.base_url || '';
  form.model = d.model || '';
  masked.value = d.api_key_masked || '';
});

async function onSave() {
  await http.put('/ai/config', form);
  ElMessage.success('已保存（api_key 加密落配置文件，Redis 仅作读缓存）');
  const d: any = await http.get('/ai/config');
  masked.value = d.api_key_masked || '';
  form.api_key = '';
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
