import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import MediaUpload from '../../src/components/MediaUpload.vue';
import type { MediaUploadResponse } from '../../src/api/media';

const Fixture = {
  components: { MediaUpload },
  setup() {
    const assetId = ref<string | null>(null);
    const lastResult = ref<MediaUploadResponse | null>(null);
    const lastError = ref('');
    return () => h('section', { style: 'max-width: 720px; margin: 40px auto; padding: 24px; font-family: system-ui, sans-serif' }, [
      h('h1', 'MediaUpload 实际接口夹具'),
      h('p', '使用当前浏览器已有登录会话，请选择真实 MP4 文件验证大小、进度、探测与重试。'),
      h(MediaUpload, {
        modelValue: assetId.value,
        purpose: 'video',
        'onUpdate:modelValue': (value: string | null) => { assetId.value = value; },
        onUploaded: (value: MediaUploadResponse) => { lastResult.value = value; },
        onError: (value: { message: string }) => { lastError.value = value.message; },
      }),
      h('dl', { style: 'margin-top: 20px; line-height: 1.8' }, [
        h('dt', '绑定 asset_id'),
        h('dd', assetId.value || '—'),
        h('dt', '最近响应'),
        h('dd', [h('code', lastResult.value ? JSON.stringify(lastResult.value) : '—')]),
        h('dt', '最近错误'),
        h('dd', lastError.value || '—'),
      ]),
    ]);
  },
};

createApp(Fixture).use(createPinia()).mount('#app');
