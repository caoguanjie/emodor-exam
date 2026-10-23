<template>
  <section class="page-card">
    <div class="toolbar">
      <el-button :disabled="!dirty" @click="reset">撤销修改</el-button>
      <el-button v-if="canWrite" type="primary" :loading="saving" :disabled="!dirty" @click="save">保存并发布</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false">
      <el-button link @click="load">重试</el-button>
    </el-alert>

    <div v-loading="loading" class="settings-grid">
      <div class="setting-block">
        <h3>网站 Logo</h3>
        <el-upload
          ref="logoUpload"
          v-model:file-list="logoFiles"
          class="logo-uploader"
          :class="{ 'is-full': logoFiles.length >= 1 }"
          list-type="picture-card"
          accept="image/jpeg,image/png,image/webp"
          :limit="1"
          :disabled="!canWrite"
          :http-request="uploadBranding"
          :on-preview="previewLogo"
          :on-change="onLogoChange"
          :on-success="onLogoSuccess"
          :on-remove="onLogoRemove"
          :on-exceed="onLogoExceed"
        >
          <el-icon><Plus /></el-icon>
        </el-upload>
        <p class="hint">支持 JPG、PNG、WebP，单张最大 10 MiB；悬停可预览或删除，修改后点击“保存并发布”生效。</p>
      </div>

      <div class="setting-block banner-setting">
        <div class="block-head">
          <h3>首页轮播图</h3>
          <el-tag type="info">最多 3 张</el-tag>
        </div>
        <el-upload
          v-model:file-list="bannerFiles"
          class="banner-uploader"
          :class="{ 'is-full': bannerFiles.length >= 3 }"
          list-type="picture-card"
          accept="image/jpeg,image/png,image/webp"
          :multiple="true"
          :limit="3"
          :disabled="!canWrite"
          :http-request="uploadBranding"
          :on-preview="previewBanner"
          :on-change="onBannerChange"
          :on-success="onBannerSuccess"
          :on-remove="onBannerRemove"
          :on-exceed="onBannerExceed"
        >
          <el-icon><Plus /></el-icon>
        </el-upload>
        <p class="hint">可一次选择多张图片，按添加顺序展示；支持 JPG、PNG、WebP，单张最大 10 MiB。点击预览可左右切换，需调整时删除后重新添加。</p>
      </div>

      <div v-if="saved.banners.length" class="setting-block public-banners">
        <h3>当前公开轮播</h3>
        <el-carousel height="180px">
          <el-carousel-item v-for="banner in saved.banners" :key="banner.asset_id">
            <img :src="publicSiteAssetUrl(banner.asset_id)" alt="公开轮播图" />
          </el-carousel-item>
        </el-carousel>
      </div>
    </div>
    <el-image-viewer
      v-if="imagePreview"
      :url-list="imagePreview.urls"
      :initial-index="imagePreview.index"
      :teleported="true"
      :show-progress="true"
      @close="imagePreview = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import type { UploadFile, UploadInstance, UploadRawFile, UploadRequestOptions, UploadUserFile } from 'element-plus';
import http, { publicSiteAssetUrl } from '../../api/http';
import { getMediaMetadata, uploadMedia } from '../../api/media';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { addSiteBanner, type SiteBannerDraft } from './site-settings-state';

interface SiteConfig {
  logo_asset_id: string | null;
  banners: SiteBannerDraft[];
}

interface SiteBannerFile extends UploadUserFile {
  assetId?: string;
}

interface SiteLogoFile extends UploadUserFile {
  assetId?: string;
}

const MAX_BANNER_POLL_ATTEMPTS = 30;
const auth = useAuthStore();
const canWrite = computed(() => auth.can('system_settings:write'));
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const dirty = ref(false);
const logoUpload = ref<UploadInstance>();
const logoFiles = ref<SiteLogoFile[]>([]);
const bannerFiles = ref<SiteBannerFile[]>([]);
const imagePreview = ref<{ urls: string[]; index: number } | null>(null);
const saved = reactive<SiteConfig>({ logo_asset_id: null, banners: [] });
const form = reactive<{ logo_asset_id: string | null; banners: SiteBannerDraft[] }>({ logo_asset_id: null, banners: [] });
const unsaved = useUnsavedChanges(dirty, { onDiscard: restoreSaved });
const logoObjectUrl = ref<string | null>(null);
const bannerObjectUrls = new Map<number, string>();
let nextSavedBannerUid = -1;
let applying = false;

watch(form, () => {
  if (!applying) dirty.value = JSON.stringify(payload()) !== JSON.stringify(saved);
}, { deep: true });

function payload(): SiteConfig {
  return {
    logo_asset_id: form.logo_asset_id || null,
    banners: [...form.banners].filter((item) => !!item.asset_id).sort((left, right) => left.sort - right.sort || left.asset_id.localeCompare(right.asset_id)),
  };
}

function revokeBannerObjectUrls() {
  for (const url of bannerObjectUrls.values()) URL.revokeObjectURL(url);
  bannerObjectUrls.clear();
}

function revokeLogoObjectUrl() {
  if (logoObjectUrl.value) URL.revokeObjectURL(logoObjectUrl.value);
  logoObjectUrl.value = null;
}

function previewLogo(file: UploadFile) {
  if (file.url) imagePreview.value = { urls: [file.url], index: 0 };
}

function previewBanner(file: UploadFile) {
  const files = bannerFiles.value.filter((item): item is SiteBannerFile & { url: string } => !!item.url);
  const index = files.findIndex((item) => item.uid === file.uid);
  if (index >= 0) imagePreview.value = { urls: files.map((item) => item.url), index };
}

function bannerFilesFromConfig(banners: readonly SiteBannerDraft[]): SiteBannerFile[] {
  return banners.map((banner, index) => ({
    uid: Number(banner.asset_id) || nextSavedBannerUid--,
    name: `轮播图-${index + 1}`,
    status: 'success',
    url: publicSiteAssetUrl(banner.asset_id),
    assetId: banner.asset_id,
  }));
}

function logoFilesFromConfig(assetId: string | null): SiteLogoFile[] {
  if (!assetId) return [];
  return [{
    uid: Number(assetId) || -1,
    name: '网站 Logo',
    status: 'success',
    url: publicSiteAssetUrl(assetId),
    assetId,
  }];
}

function apply(value: SiteConfig) {
  applying = true;
  imagePreview.value = null;
  const nextBanners = [...(value.banners || [])].sort((left, right) => left.sort - right.sort);
  Object.assign(saved, { logo_asset_id: value.logo_asset_id || null, banners: nextBanners });
  form.logo_asset_id = saved.logo_asset_id;
  form.banners = nextBanners.map((item) => ({ ...item }));
  revokeLogoObjectUrl();
  logoFiles.value = logoFilesFromConfig(saved.logo_asset_id);
  revokeBannerObjectUrls();
  bannerFiles.value = bannerFilesFromConfig(nextBanners);
  dirty.value = false;
  queueMicrotask(() => { applying = false; });
}

function restoreSaved() {
  apply({ logo_asset_id: saved.logo_asset_id, banners: [...saved.banners] });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    apply(await http.get('/admin/site-settings') as SiteConfig);
  } catch (e: any) {
    error.value = e?.message || '网站配置加载失败';
  } finally {
    loading.value = false;
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBrandingReady(assetId: string) {
  for (let attempt = 0; attempt < MAX_BANNER_POLL_ATTEMPTS; attempt += 1) {
    const metadata = await getMediaMetadata(assetId);
    if (metadata.status === 'ready') return;
    if (metadata.status === 'failed') throw new Error(metadata.probe_error || '媒体内容校验失败');
    await wait(1000);
  }
  throw new Error('媒体处理状态查询超时，请稍后重试');
}

async function uploadBranding(options: UploadRequestOptions) {
  const result = await uploadMedia(options.file, 'branding', {
    onProgress: (percent) => options.onProgress({ percent } as any),
  });
  if (!result.asset_id) throw new Error('上传响应缺少媒体标识');
  if (result.status === 'processing') await waitForBrandingReady(result.asset_id);
  if (result.status === 'failed') throw new Error('媒体内容校验失败');
  return { ...result, status: 'ready' };
}

function assetIdFromResponse(response: unknown): string {
  return typeof response === 'object' && response && 'asset_id' in response
    ? String((response as { asset_id: unknown }).asset_id || '')
    : '';
}

function onLogoChange(file: UploadFile) {
  if (!file.url && file.raw) {
    revokeLogoObjectUrl();
    logoObjectUrl.value = URL.createObjectURL(file.raw);
    file.url = logoObjectUrl.value;
  }
}

function onLogoSuccess(response: unknown, file: UploadFile) {
  const assetId = assetIdFromResponse(response);
  if (!assetId) return;
  (file as SiteLogoFile).assetId = assetId;
  form.logo_asset_id = assetId;
}

function onLogoRemove() {
  imagePreview.value = null;
  form.logo_asset_id = null;
  revokeLogoObjectUrl();
}

async function onLogoExceed(files: File[]) {
  const rawFile = files[0] as UploadRawFile | undefined;
  if (!rawFile) return;
  logoUpload.value?.clearFiles();
  await nextTick();
  logoUpload.value?.handleStart(rawFile);
  await nextTick();
  logoUpload.value?.submit();
}

function onBannerChange(file: UploadFile) {
  if (!file.url && file.raw) {
    const url = URL.createObjectURL(file.raw);
    bannerObjectUrls.set(file.uid, url);
    file.url = url;
  }
}

function syncBannerOrder(files: readonly SiteBannerFile[]) {
  form.banners = files.reduce<SiteBannerDraft[]>((banners, file) => (
    addSiteBanner(banners, file.assetId || assetIdFromResponse(file.response))
  ), []);
}

function onBannerSuccess(response: unknown, file: UploadFile, files: SiteBannerFile[] = bannerFiles.value) {
  const assetId = assetIdFromResponse(response);
  if (!assetId) return;
  (file as SiteBannerFile).assetId = assetId;
  syncBannerOrder(files);
}

function onBannerRemove(file: UploadFile, files: SiteBannerFile[] = bannerFiles.value) {
  imagePreview.value = null;
  syncBannerOrder(files.filter((item) => item.uid !== file.uid));
  const previewUrl = bannerObjectUrls.get(file.uid);
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    bannerObjectUrls.delete(file.uid);
  }
}

function onBannerExceed() {
  ElMessage.warning('首页轮播图最多上传 3 张');
}

async function reset() {
  await unsaved.confirmDiscard();
}

async function save() {
  const next = payload();
  saving.value = true;
  try {
    const result = await http.put('/admin/site-settings', next) as SiteConfig;
    apply(result);
    ElMessage.success('网站配置已发布');
  } finally {
    saving.value = false;
  }
}

void load();

onDeactivated(() => { imagePreview.value = null; });

onBeforeUnmount(() => {
  revokeLogoObjectUrl();
  revokeBannerObjectUrls();
});
</script>

<style scoped>
.page-card { background: #fff; border: 1px solid var(--re-border); border-radius: 12px; padding: 20px; min-height: 420px; }
.block-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.setting-block h3 { margin: 0 0 8px; }
.hint { margin: 8px 0 0; color: var(--re-text-3); font-size: 12px; line-height: 1.5; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
.setting-block { border: 1px solid var(--re-border); border-radius: 10px; padding: 16px; }
.logo-uploader :deep(.el-upload--picture-card),
.logo-uploader :deep(.el-upload-list--picture-card .el-upload-list__item),
.banner-uploader :deep(.el-upload--picture-card),
.banner-uploader :deep(.el-upload-list--picture-card .el-upload-list__item) { width: 112px; height: 84px; }
.logo-uploader.is-full :deep(.el-upload--picture-card),
.banner-uploader.is-full :deep(.el-upload--picture-card) { display: none; }
.logo-uploader :deep(.el-upload-list--picture-card .el-upload-list__item-thumbnail) { object-fit: contain; }
.banner-uploader :deep(.el-upload-list--picture-card .el-upload-list__item-thumbnail) { object-fit: cover; }
.public-banners img { width: 100%; height: 100%; object-fit: cover; }
</style>
