<template>
  <div class="page-card site-settings-page">
    <el-tabs v-model="activeTab" class="site-settings-tabs">
      <el-tab-pane label="品牌展示" name="branding">
        <section v-loading="loadingBranding" class="branding-setting">
          <div class="card-head">
            <div class="toolbar">
              <el-button :disabled="!brandingDirty || savingBranding" @click="resetBranding">撤销修改</el-button>
              <el-button v-if="canWrite" type="primary" :loading="savingBranding" :disabled="!brandingDirty" @click="saveBranding">保存并发布</el-button>
            </div>
          </div>
          <el-alert v-if="brandingError" :title="brandingError" type="error" show-icon :closable="false">
            <el-button link @click="load('branding')">重试</el-button>
          </el-alert>

          <div class="settings-grid">
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
                :disabled="!canWrite || loadingBranding || savingBranding"
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
                <h3>学员端首页轮播图</h3>
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
                :disabled="!canWrite || loadingBranding || savingBranding"
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
          </div>
        </section>
      </el-tab-pane>

      <el-tab-pane label="关于我们" name="about">
        <section v-loading="loadingAbout" class="about-setting">
          <div class="card-head">
            <div class="toolbar">
              <el-button :disabled="!aboutDirty || savingAbout" @click="resetAbout">撤销修改</el-button>
              <el-button v-if="canWrite" type="primary" :loading="savingAbout" :disabled="!aboutDirty" @click="saveAbout">保存并发布</el-button>
            </div>
          </div>
          <el-alert v-if="aboutLoadError" :title="aboutLoadError" type="error" show-icon :closable="false">
            <el-button link @click="load('about')">重试</el-button>
          </el-alert>
          <el-alert v-if="aboutError" class="about-error" :title="aboutError" type="error" show-icon :closable="false" />
          <el-form label-position="top" :disabled="!canWrite || loadingAbout || savingAbout" @submit.prevent="saveAbout">
            <div class="about-fields">
              <el-form-item v-for="field in SITE_ABOUT_FIELDS" :key="field.key" :label="field.label" :required="field.required">
                <el-input
                  v-model="aboutForm[field.key]"
                  :aria-label="field.label"
                  :maxlength="field.max"
                  :type="field.key === 'contact_email' ? 'email' : field.key === 'contact_phone' ? 'tel' : 'text'"
                  :inputmode="field.key === 'contact_phone' ? 'tel' : undefined"
                  :placeholder="field.required ? `请输入${field.label}` : '选填，留空不展示'"
                />
              </el-form-item>
            </div>
            <el-form-item label="服务条款" class="terms-field">
              <div class="terms-editor">
                <TiptapEditor
                  :model-value="aboutForm.service_terms || EMPTY_TERMS"
                  profile="rich"
                  presentation="inline"
                  :show-panels="false"
                  :mode="canWrite && !loadingAbout && !savingAbout ? 'edit' : 'preview'"
                  @update:model-value="updateTerms"
                />
              </div>
              <p class="hint">支持文字排版，链接仅保留文字，不支持图片或媒体。条款留空后，学员端不展示服务条款入口。Logo 使用“品牌展示”页签中的配置。</p>
            </el-form-item>
          </el-form>
        </section>
      </el-tab-pane>
    </el-tabs>
    <el-image-viewer
      v-if="imagePreview"
      :url-list="imagePreview.urls"
      :initial-index="imagePreview.index"
      :teleported="true"
      :show-progress="true"
      @close="imagePreview = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import type { UploadFile, UploadInstance, UploadRawFile, UploadRequestOptions, UploadUserFile } from 'element-plus';
import http from '../../api/http';
import { resolvePublicBranding } from '../../services/media-content';
import { getMediaMetadata, uploadMedia } from '../../api/media';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
import { addSiteBanner, type SiteBannerDraft } from './site-settings-state';
import TiptapEditor from '../../components/Tiptap/index.vue';
import type { JSONContent } from '@tiptap/core';
import { cloneSiteAbout, defaultSiteAbout, serviceTermsFromEditor, siteAboutPayload, SITE_ABOUT_FIELDS, type SiteAboutSettings } from './site-about-settings';

interface BrandingConfig {
  logo_asset_id: string | null;
  banners: SiteBannerDraft[];
}

interface SiteConfig extends BrandingConfig {
  about?: SiteAboutSettings;
}

interface SiteBannerFile extends UploadUserFile {
  assetId?: string;
}

interface SiteLogoFile extends UploadUserFile {
  assetId?: string;
}

const MAX_BANNER_POLL_ATTEMPTS = 30;
const EMPTY_TERMS: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const activeTab = ref('branding');
const auth = useAuthStore();
const canWrite = computed(() => auth.can('system_settings:write'));
const loadingBranding = ref(false);
const loadingAbout = ref(false);
const savingBranding = ref(false);
const savingAbout = ref(false);
const brandingError = ref('');
const aboutLoadError = ref('');
const aboutError = ref('');
const logoUpload = ref<UploadInstance>();
const logoFiles = ref<SiteLogoFile[]>([]);
const bannerFiles = ref<SiteBannerFile[]>([]);
const imagePreview = ref<{ urls: string[]; index: number } | null>(null);
const saved = reactive<BrandingConfig>({ logo_asset_id: null, banners: [] });
const form = reactive<{ logo_asset_id: string | null; banners: SiteBannerDraft[] }>({ logo_asset_id: null, banners: [] });
const aboutSaved = reactive<SiteAboutSettings>(defaultSiteAbout());
const aboutForm = reactive<SiteAboutSettings>(cloneSiteAbout(aboutSaved));
const brandingDirty = computed(() => JSON.stringify(payload()) !== JSON.stringify(saved));
const aboutDirty = computed(() => aboutFingerprint(aboutForm) !== aboutFingerprint(aboutSaved));
const dirty = computed(() => brandingDirty.value || aboutDirty.value);
useUnsavedChanges(dirty, {
  onDiscard: restoreSaved,
  canDiscard: () => !savingBranding.value && !savingAbout.value,
});
const logoObjectUrl = ref<string | null>(null);
const bannerObjectUrls = new Map<number, string>();
let nextSavedBannerUid = -1;

function payload(): BrandingConfig {
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
    url: resolvePublicBranding(banner.asset_id),
    assetId: banner.asset_id,
  }));
}

function logoFilesFromConfig(assetId: string | null): SiteLogoFile[] {
  if (!assetId) return [];
  return [{
    uid: Number(assetId) || -1,
    name: '网站 Logo',
    status: 'success',
    url: resolvePublicBranding(assetId),
    assetId,
  }];
}

function applyBranding(value: BrandingConfig) {
  imagePreview.value = null;
  const nextBanners = [...(value.banners || [])].sort((left, right) => left.sort - right.sort);
  Object.assign(saved, { logo_asset_id: value.logo_asset_id || null, banners: nextBanners });
  form.logo_asset_id = saved.logo_asset_id;
  form.banners = nextBanners.map((item) => ({ ...item }));
  revokeLogoObjectUrl();
  logoFiles.value = logoFilesFromConfig(saved.logo_asset_id);
  revokeBannerObjectUrls();
  bannerFiles.value = bannerFilesFromConfig(nextBanners);
}

function applyAbout(value: SiteAboutSettings = defaultSiteAbout()) {
  const next = cloneSiteAbout(value);
  for (const target of [aboutSaved, aboutForm]) {
    for (const key of Object.keys(target)) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) delete (target as unknown as Record<string, unknown>)[key];
    }
    Object.assign(target, cloneSiteAbout(next));
  }
  aboutError.value = '';
}

function aboutFingerprint(value: SiteAboutSettings): string {
  const projected = cloneSiteAbout(value);
  try {
    return JSON.stringify({ ...projected, service_terms: serviceTermsFromEditor(projected.service_terms) });
  } catch {
    return JSON.stringify(projected);
  }
}

function restoreSaved() {
  applyBranding({ logo_asset_id: saved.logo_asset_id, banners: [...saved.banners] });
  applyAbout(aboutSaved);
}

async function load(part: 'branding' | 'about' | 'both' = 'both') {
  if (part !== 'about') { loadingBranding.value = true; brandingError.value = ''; }
  if (part !== 'branding') { loadingAbout.value = true; aboutLoadError.value = ''; }
  try {
    const value = await http.get('/admin/site-settings') as SiteConfig;
    if (part !== 'about') applyBranding(value);
    if (part !== 'branding') applyAbout(value.about);
  } catch (e: any) {
    const message = e?.message || '网站配置加载失败';
    if (part !== 'about') brandingError.value = message;
    if (part !== 'branding') aboutLoadError.value = message;
  } finally {
    if (part !== 'about') loadingBranding.value = false;
    if (part !== 'branding') loadingAbout.value = false;
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
  ElMessage.warning('学员端首页轮播图最多上传 3 张');
}

async function confirmReset(label: string, restore: () => void) {
  try {
    await ElMessageBox.confirm(`确定撤销${label}的未保存修改吗？`, '未保存提醒', {
      type: 'warning', confirmButtonText: '放弃修改', cancelButtonText: '继续编辑',
    });
    restore();
  } catch { /* Continue editing when confirmation is cancelled. */ }
}

async function resetBranding() {
  if (!brandingDirty.value || savingBranding.value) return;
  await confirmReset('品牌展示', () => applyBranding(saved));
}

async function resetAbout() {
  if (!aboutDirty.value || savingAbout.value) return;
  await confirmReset('关于我们', () => applyAbout(aboutSaved));
}

function updateTerms(document: JSONContent) {
  if (!canWrite.value || loadingAbout.value || savingAbout.value) return;
  aboutForm.service_terms = JSON.parse(JSON.stringify(document)) as JSONContent;
  try {
    // Keep the exact editor document while typing. Replacing its nullable
    // defaults with persisted JSON would reset the selection on every update.
    serviceTermsFromEditor(document);
    aboutError.value = '';
  } catch (e: any) {
    // Retain the invalid draft so saving cannot silently publish older terms.
    aboutError.value = e?.message || '服务条款格式错误';
  }
}

async function saveBranding() {
  if (!canWrite.value || !brandingDirty.value || loadingBranding.value || savingBranding.value) return;
  const next = payload();
  savingBranding.value = true;
  brandingError.value = '';
  try {
    const result = await http.put('/admin/site-settings', next) as SiteConfig;
    applyBranding(result);
    ElMessage.success('品牌展示配置已发布');
  } catch (e: any) {
    brandingError.value = e?.message || '品牌展示配置发布失败';
  } finally {
    savingBranding.value = false;
  }
}

async function saveAbout() {
  if (!canWrite.value || !aboutDirty.value || loadingAbout.value || savingAbout.value) return;
  aboutError.value = '';
  try {
    const next = siteAboutPayload(aboutForm);
    savingAbout.value = true;
    const result = await http.put('/admin/site-settings', { about: next }) as SiteConfig;
    if (!result.about) throw new Error('服务器未返回关于我们配置，请重试');
    applyAbout(result.about);
    ElMessage.success('关于我们配置已发布');
  } catch (e: any) {
    aboutError.value = e?.message || '关于我们配置发布失败';
  } finally {
    savingAbout.value = false;
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
.card-head { display: flex; align-items: center; justify-content: flex-end; margin: 8px 0 16px; }
.toolbar { display: flex; align-items: center; justify-content: flex-end; margin: 0; gap: 0; }
.block-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.setting-block h3 { margin: 0 0 8px; }
.hint { margin: 8px 0 0; color: var(--re-text-3); font-size: 12px; line-height: 1.5; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
.setting-block { border: 1px solid var(--re-border); border-radius: 10px; padding: 16px; }
.about-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 24px; }
.about-error { margin-bottom: 18px; }
.terms-editor { width: 100%; border: 1px solid var(--re-border); border-radius: 8px; overflow: hidden; }
.terms-editor :deep(.ruleexam-tiptap-inline .header) { padding: 8px 12px; }
.terms-editor :deep(.editor-main) { padding: 0; }
.terms-editor :deep(.editor-main-wrapp--fluid) { background: #fff; }
/* Service-agreement reading typography; deliberately scoped away from question editors. */
.terms-editor :deep(.ProseMirror) { min-height: 200px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important; font-size: 14px !important; line-height: 1.8 !important; color: #646566 !important; padding: 20px !important; }
.terms-editor :deep(.ProseMirror p) { font-size: 14px !important; line-height: 1.8 !important; margin: 0 !important; }
.terms-editor :deep(.ProseMirror h1),
.terms-editor :deep(.ProseMirror h2),
.terms-editor :deep(.ProseMirror h3),
.terms-editor :deep(.ProseMirror h4) { font-size: 14px !important; font-weight: 600 !important; line-height: 1.8 !important; color: #323233 !important; margin: 20px 0 8px !important; }
.terms-editor :deep(.ProseMirror > h1:first-child) { font-size: 18px !important; line-height: 1.5 !important; text-align: center !important; margin: 0 0 20px !important; }
.terms-editor :deep(.ProseMirror > h1:first-child + p) { line-height: 1.5 !important; }
.terms-editor :deep(.ProseMirror > p + p) { margin-top: 1.8em !important; }
.terms-field { margin-bottom: 0; }
.logo-uploader :deep(.el-upload--picture-card),
.logo-uploader :deep(.el-upload-list--picture-card .el-upload-list__item),
.banner-uploader :deep(.el-upload--picture-card),
.banner-uploader :deep(.el-upload-list--picture-card .el-upload-list__item) { width: 112px; height: 84px; }
.logo-uploader.is-full :deep(.el-upload--picture-card),
.banner-uploader.is-full :deep(.el-upload--picture-card) { display: none; }
.logo-uploader :deep(.el-upload-list--picture-card .el-upload-list__item-thumbnail) { object-fit: contain; }
.banner-uploader :deep(.el-upload-list--picture-card .el-upload-list__item-thumbnail) { object-fit: cover; }
@media (max-width: 1100px) { .about-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) {
  .about-fields { grid-template-columns: minmax(0, 1fr); }
  .settings-grid { grid-template-columns: minmax(0, 1fr); }
  .card-head { flex-wrap: wrap; }
}
</style>
