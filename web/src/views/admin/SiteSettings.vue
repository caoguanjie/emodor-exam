<template>
  <section class="page-card">
    <div class="toolbar"><el-button :disabled="!dirty" @click="reset">撤销修改</el-button><el-button v-if="canWrite" type="primary" :loading="saving" :disabled="!dirty" @click="save">保存并发布</el-button></div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button link @click="load">重试</el-button></el-alert>
    <div v-loading="loading" class="settings-grid">
      <div class="setting-block"><h3>网站 Logo</h3><MediaUpload v-model="form.logo_asset_id" purpose="branding" :disabled="!canWrite"/><img v-if="saved.logo_asset_id" class="public-preview logo-preview" :src="publicSiteAssetUrl(saved.logo_asset_id)" alt="当前公开 Logo"/><p class="hint">下方预览来自公开白名单；选择新图后需点击“保存并发布”。</p></div>
      <div class="setting-block"><div class="block-head"><h3>首页轮播图</h3><el-button v-if="canWrite" :disabled="form.banners.length>=3" @click="addBanner">新增轮播</el-button></div><el-empty v-if="!form.banners.length" description="暂无轮播图" :image-size="70"/><div v-for="(banner,index) in form.banners" :key="banner.key" class="banner-row"><MediaUpload v-model="banner.asset_id" purpose="branding" :disabled="!canWrite"/><div class="banner-meta"><span>排序</span><el-input-number v-model="banner.sort" :min="0" :max="100000" :disabled="!canWrite"/><el-button v-if="canWrite" type="danger" plain @click="removeBanner(index)">移除</el-button></div></div></div>
      <div v-if="saved.banners.length" class="setting-block public-banners"><h3>当前公开轮播</h3><el-carousel height="180px"><el-carousel-item v-for="banner in saved.banners" :key="banner.asset_id"><img :src="publicSiteAssetUrl(banner.asset_id)" alt="公开轮播图"/></el-carousel-item></el-carousel></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'; import { ElMessage } from 'element-plus'; import http, { publicSiteAssetUrl } from '../../api/http'; import MediaUpload from '../../components/MediaUpload.vue'; import { useAuthStore } from '../../stores/auth'; import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
interface Banner{asset_id:string|null;sort:number;key:string} interface SiteConfig{logo_asset_id:string|null;banners:{asset_id:string;sort:number}[]}
const auth=useAuthStore(); const canWrite=computed(()=>auth.can('system_settings:write')); const loading=ref(false); const saving=ref(false); const error=ref(''); const dirty=ref(false); const saved=reactive<SiteConfig>({logo_asset_id:null,banners:[]}); const form=reactive<{logo_asset_id:string|null;banners:Banner[]}>({logo_asset_id:null,banners:[]}); const unsaved=useUnsavedChanges(dirty,{onDiscard:restoreSaved}); let applying=false;
watch(form,()=>{if(!applying)dirty.value=JSON.stringify(payload())!==JSON.stringify(saved)},{deep:true});
function payload():SiteConfig{return{logo_asset_id:form.logo_asset_id||null,banners:form.banners.filter((item):item is Banner&{asset_id:string}=>!!item.asset_id).map(item=>({asset_id:item.asset_id,sort:item.sort})).sort((a,b)=>a.sort-b.sort)}}
function apply(value:SiteConfig){applying=true;Object.assign(saved,{logo_asset_id:value.logo_asset_id||null,banners:[...(value.banners||[])]});form.logo_asset_id=saved.logo_asset_id;form.banners=saved.banners.map((item,index)=>({...item,key:`${item.asset_id}-${index}`}));dirty.value=false;queueMicrotask(()=>{applying=false})}
function restoreSaved(){apply({logo_asset_id:saved.logo_asset_id,banners:[...saved.banners]})}
async function load(){loading.value=true;error.value='';try{apply(await http.get('/admin/site-settings') as SiteConfig)}catch(e:any){error.value=e?.message||'网站配置加载失败'}finally{loading.value=false}}
function addBanner(){if(form.banners.length<3)form.banners.push({asset_id:null,sort:(form.banners.at(-1)?.sort||0)+10,key:`new-${Date.now()}-${form.banners.length}`})} function removeBanner(index:number){form.banners.splice(index,1)}
async function reset(){await unsaved.confirmDiscard()}
async function save(){const next=payload();if(form.banners.some(item=>!item.asset_id)){ElMessage.warning('请完成每个轮播图上传，或移除空白项');return} saving.value=true;try{const result=await http.put('/admin/site-settings',next) as SiteConfig;apply(result);ElMessage.success('网站配置已发布')}finally{saving.value=false}}
void load();
</script>
<style scoped>.page-card{background:#fff;border:1px solid var(--re-border);border-radius:12px;padding:20px;min-height:420px}.block-head{display:flex;justify-content:space-between;gap:16px}.setting-block h3{margin:0 0 5px}.hint{margin:0;color:var(--re-text-3)}.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}.setting-block{border:1px solid var(--re-border);border-radius:10px;padding:16px}.banner-row{border-top:1px dashed var(--re-border);padding-top:14px;margin-top:14px}.banner-meta{display:flex;gap:10px;align-items:center;margin-top:10px}.public-preview{display:block;object-fit:contain;margin-top:12px;border:1px solid var(--re-border);border-radius:8px}.logo-preview{width:160px;height:80px}.hint{font-size:12px;margin-top:8px}.public-banners img{width:100%;height:100%;object-fit:cover}</style>
