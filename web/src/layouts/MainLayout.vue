<template>
  <el-container class="shell">
    <el-aside width="232px" class="aside">
      <div class="logo">
        <img class="logo-badge" :src="logoSrc" alt="海珠区安全教育培训中心 Logo" />
        <div class="logo-text"><span class="logo-name">海珠区安全教育培训中心</span><span class="logo-sub">安全教育培训与考试平台</span></div>
      </div>
      <el-carousel v-if="bannerUrls.length" class="brand-carousel" height="74px" indicator-position="none" arrow="never" :interval="5000">
        <el-carousel-item v-for="url in bannerUrls" :key="url"><img :src="url" alt="站点轮播图" /></el-carousel-item>
      </el-carousel>
      <el-scrollbar class="nav-scroll">
        <el-menu :default-active="route.path" :default-openeds="defaultOpeneds" router class="nav-menu">
          <template v-if="auth.isAdmin">
            <template v-for="group in adminGroups" :key="group.name">
              <el-menu-item v-if="group.path" :index="group.path">
                <el-icon v-if="iconFor(group.icon)"><component :is="iconFor(group.icon)" /></el-icon>{{ group.name }}
              </el-menu-item>
              <el-sub-menu v-else :index="group.id">
                <template #title><el-icon v-if="iconFor(group.icon)"><component :is="iconFor(group.icon)" /></el-icon><span>{{ group.name }}</span></template>
                <el-menu-item v-for="item in group.items" :key="item.path" :index="item.path">
                  <el-icon v-if="iconFor(item.icon)"><component :is="iconFor(item.icon)" /></el-icon>{{ item.name }}
                </el-menu-item>
              </el-sub-menu>
            </template>
          </template>
          <template v-else>
            <li class="nav-group">我的学习</li>
            <el-menu-item index="/my/regulations"><el-icon><Reading /></el-icon>我的制度</el-menu-item>
            <el-menu-item index="/my/exams"><el-icon><AlarmClock /></el-icon>我的考试</el-menu-item>
            <el-menu-item index="/my/scores"><el-icon><Medal /></el-icon>我的成绩</el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>
      <div class="aside-foot">学习留痕 · 服务端计时</div>
    </el-aside>
    <el-container class="content-shell">
      <el-header class="header">
        <span class="page-title">{{ route.meta.title || '海珠区安全教育培训中心' }}</span>
        <div class="header-right">
          <el-dropdown trigger="click" @command="onUserCommand">
            <div class="user-chip"><span class="avatar">{{ avatarChar }}</span><span class="user-meta"><b>{{ auth.user?.real_name }}</b><i>{{ roleLabel }}</i></span></div>
            <template #dropdown><el-dropdown-menu><el-dropdown-item command="profile">本人资料</el-dropdown-item><el-dropdown-item command="password">修改密码</el-dropdown-item><el-dropdown-item divided command="logout">退出登录</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown>
        </div>
      </el-header>
      <div v-if="tabs.tabs.length" class="tabs-bar">
        <el-scrollbar><div class="tabs-list"><el-tag v-for="tab in tabs.tabs" :key="tab.path" :effect="tab.path===route.fullPath?'dark':'plain'" closable @click="router.push(tab.path)" @close.stop="closeTab(tab.path)">{{ tab.title }}</el-tag></div></el-scrollbar>
        <el-dropdown @command="onTabCommand"><el-button text><el-icon><MoreFilled /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="refresh">刷新当前</el-dropdown-item><el-dropdown-item command="others">关闭其它</el-dropdown-item><el-dropdown-item command="all">关闭全部</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
      </div>
      <el-main class="main">
        <router-view v-slot="{ Component, route: viewRoute }">
          <KeepAlive :max="20">
            <component v-if="viewRoute.meta.cache" :is="Component" :key="tabCacheKey(viewRoute.fullPath, cacheVersions)" class="page-enter" />
          </KeepAlive>
          <component v-if="!viewRoute.meta.cache" :is="Component" :key="tabCacheKey(viewRoute.fullPath, cacheVersions)" class="page-enter" />
        </router-view>
      </el-main>
    </el-container>

    <el-dialog v-model="profileVisible" title="本人资料" width="560px" :before-close="beforeProfileClose">
      <el-form label-width="90px" v-loading="profileLoading">
        <el-form-item label="头像"><MediaUpload v-model="profile.avatar_id" purpose="avatar" :owner-id="String(auth.user?.id || '')" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="profile.real_name" maxlength="64" /></el-form-item>
        <el-form-item label="手机"><el-input v-model="profile.phone" maxlength="32" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="profile.email" maxlength="128" /></el-form-item>
        <el-form-item label="学员属性"><span>{{ profile.source || '—' }} / 类别 {{ profile.category_id || '—' }}</span></el-form-item>
      </el-form>
      <template #footer><el-button @click="closeProfile">取消</el-button><el-button type="primary" :loading="profileSaving" @click="saveProfile">保存</el-button></template>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  AlarmClock, CollectionTag, Cpu, DataAnalysis, Document, DocumentChecked, EditPen,
  Grid, Menu as MenuIcon, Medal, Monitor, MoreFilled, Notebook, OfficeBuilding,
  Picture, Reading, Setting, SetUp, Tickets, User, UserFilled,
} from '@element-plus/icons-vue';
import http, { publicSiteAssetUrl } from '../api/http';
import MediaUpload from '../components/MediaUpload.vue';
import { confirmAllUnsavedChanges, confirmUnsavedChanges, useUnsavedChanges } from '../composables/useUnsavedChanges';
import { useAuthStore } from '../stores/auth';
import { useTabsStore } from '../stores/tabs';
import { invalidateTabCache, tabCacheKey, type TabCacheVersions } from '../stores/tab-cache';
import { defaultHomePath, routeAccessAllowed } from '../router/access';
import defaultBrandLogo from '../assets/brand-logo.png';

interface NavigationNode { id:string; name:string; type:'directory'|'menu'|'button'; route_path:string|null; permission_code:string|null; icon:string|null; status:number; children:NavigationNode[] }
interface NavigationItem { name:string; path:string; icon:string|null }
interface NavigationGroup { id:string; name:string; path:string|null; icon:string|null; items:NavigationItem[] }
interface SiteConfig { logo_asset_id:string|null; banners:{asset_id:string;sort:number}[] }
interface ProfileData { real_name:string; phone:string; email:string; avatar_id:string|null; source:string|null; category_id:string|null }
const route=useRoute(); const router=useRouter(); const auth=useAuthStore(); const tabs=useTabsStore(); const cacheVersions=reactive<TabCacheVersions>({}); const adminGroups=ref<NavigationGroup[]>([]); const siteConfig=reactive<SiteConfig>({logo_asset_id:null,banners:[]});
const profileVisible=ref(false);const profileLoading=ref(false);const profileSaving=ref(false);const profileDirty=ref(false);let applyingProfile=false;const profile=reactive<ProfileData>({real_name:'',phone:'',email:'',avatar_id:null,source:null,category_id:null});
let profileBaseline:ProfileData={...profile};
const profileRouteKey=computed(()=>route.fullPath);
const profileUnsaved=useUnsavedChanges(profileDirty,{routeKey:profileRouteKey,onDiscard:discardProfile});

const iconMap:Record<string,Component>={AlarmClock,CollectionTag,Cpu,DataAnalysis,Document,DocumentChecked,EditPen,Grid,Menu:MenuIcon,Medal,Monitor,Notebook,OfficeBuilding,Picture,Reading,Setting,SetUp,Tickets,User,UserFilled};
const iconFor=(name:string|null)=>name?iconMap[name]||Setting:null;
const roleLabel=computed(()=>auth.user?.role==='super_admin'?'超级管理员':auth.user?.role==='regulation_admin'||auth.user?.permissions?.length?'业务管理员':'学员');
const avatarChar=computed(()=>(auth.user?.real_name||'用').slice(0,1));
const logoSrc=computed(()=>siteConfig.logo_asset_id?publicSiteAssetUrl(siteConfig.logo_asset_id):defaultBrandLogo);
const bannerUrls=computed(()=>siteConfig.banners.map(item=>publicSiteAssetUrl(item.asset_id)));
const defaultOpeneds=computed(()=>adminGroups.value.filter(group=>!group.path&&group.name!=='系统设置').map(group=>group.id));
const homePath=computed(()=>defaultHomePath(auth.isAdmin));

function routeAllowed(path:string){const resolved=router.resolve(path);if(!resolved.matched.length||resolved.matched.some(record=>record.path.includes(':pathMatch')))return false;return routeAccessAllowed(resolved.meta,auth.can,auth.isSuperAdmin)}
function flattenMenus(nodes:NavigationNode[], output:NavigationItem[]=[]){for(const node of nodes){if(!node.status)continue;if(node.type==='menu'&&node.route_path&&routeAllowed(node.route_path))output.push({name:node.name,path:node.route_path,icon:node.icon});if(node.children?.length)flattenMenus(node.children,output)}return output}
async function loadNavigation(){if(!auth.isAdmin){adminGroups.value=[];return}try{const roots=await http.get('/admin/menus/navigation') as NavigationNode[];adminGroups.value=roots.filter(root=>root.status).map(root=>{const directPath=root.type==='menu'&&root.route_path&&routeAllowed(root.route_path)?root.route_path:null;return{id:String(root.id),name:root.name,path:directPath,icon:root.icon,items:directPath?[]:flattenMenus(root.children||[])}}).filter(group=>!!group.path||group.items.length>0)}catch{adminGroups.value=[]}}
async function loadSiteConfig(){try{const value=await http.get('/site-config') as SiteConfig;siteConfig.logo_asset_id=value.logo_asset_id||null;siteConfig.banners=[...(value.banners||[])]}catch{/* bundled logo remains */}}

watch(()=>route.fullPath,()=>{tabs.visit(route.fullPath,String(route.meta.title||'未命名页面'))},{immediate:true});
watch(profile,()=>{if(profileVisible.value&&!applyingProfile)profileDirty.value=true},{deep:true});

async function closeTab(path:string){const active=route.fullPath===path;const result=await tabs.close(path,homePath.value);if(!result.closed)return;if(active)await router.push(result.nextPath||homePath.value);invalidateTabCache(cacheVersions,[path])}
async function onTabCommand(command:string){if(command==='refresh'){if(await confirmUnsavedChanges(route.fullPath))invalidateTabCache(cacheVersions,[route.fullPath])}else if(command==='others'){const removed=tabs.tabs.filter(tab=>tab.path!==route.fullPath).map(tab=>tab.path);if(await tabs.closeOthers(route.fullPath))invalidateTabCache(cacheVersions,removed)}else if(command==='all'){const removed=tabs.tabs.map(tab=>tab.path);if(await tabs.closeAll()){await router.push(homePath.value);invalidateTabCache(cacheVersions,removed)}}}
function normalizeProfile(value:any):ProfileData{return{real_name:value.real_name||'',phone:value.phone||'',email:value.email||'',avatar_id:value.avatar_id?String(value.avatar_id):null,source:value.source||null,category_id:value.category_id?String(value.category_id):null}}
function applyProfile(value:any){applyingProfile=true;const normalized=normalizeProfile(value);Object.assign(profile,normalized);profileBaseline={...normalized};profileDirty.value=false;queueMicrotask(()=>{applyingProfile=false})}
function discardProfile(){applyingProfile=true;Object.assign(profile,profileBaseline);profileDirty.value=false;profileVisible.value=false;queueMicrotask(()=>{applyingProfile=false})}
async function confirmProfileDiscard(){return profileUnsaved.confirmDiscard()}
async function beforeProfileClose(done:()=>void){if(await confirmProfileDiscard()){profileVisible.value=false;done()}} async function closeProfile(){if(await confirmProfileDiscard())profileVisible.value=false}
async function openProfile(){profileVisible.value=true;profileLoading.value=true;try{applyProfile(await http.get('/me/profile'))}finally{profileLoading.value=false}}
async function saveProfile(){profileSaving.value=true;try{await http.patch('/me/profile',{real_name:profile.real_name,phone:profile.phone||null,email:profile.email||null,avatar_id:profile.avatar_id});profileBaseline={...profile};profileDirty.value=false;profileVisible.value=false;await auth.fetchProfile();ElMessage.success('本人资料已保存')}finally{profileSaving.value=false}}
async function onLogout(){try{await ElMessageBox.confirm('确定退出当前账号吗？','退出登录',{type:'warning'})}catch{return}if(!await confirmAllUnsavedChanges())return;await auth.logout();tabs.reset();await router.push('/login')}
function onUserCommand(command:string){if(command==='profile')void openProfile();else if(command==='password')void router.push('/change-password');else if(command==='logout')void onLogout()}

onMounted(()=>{void loadNavigation();void loadSiteConfig()});
</script>

<style scoped>
.shell{height:100%}.aside{background:linear-gradient(180deg,var(--re-ink) 0%,#101b36 100%);display:flex;flex-direction:column}.logo{display:flex;align-items:center;gap:10px;padding:20px 20px 16px}.logo-badge{width:36px;height:36px;border-radius:9px;object-fit:cover;flex:none}.logo-text{display:flex;flex-direction:column;line-height:1.25;min-width:0}.logo-name{color:#fff;font-size:12px;font-weight:700;letter-spacing:-0.2px;white-space:nowrap}.logo-sub{color:rgba(255,255,255,.45);font-size:10px;white-space:nowrap}.brand-carousel{margin:0 14px 8px;border-radius:8px;overflow:hidden}.brand-carousel img{width:100%;height:74px;object-fit:cover}.nav-scroll{flex:1}.nav-group{list-style:none;margin:18px 20px 6px;font-size:11px;color:rgba(255,255,255,.38);letter-spacing:3px;font-weight:600}.aside :deep(.el-menu){border-right:none;background:transparent;padding:0 10px}.aside :deep(.el-menu-item),.aside :deep(.el-sub-menu__title){color:rgba(255,255,255,.68);border-radius:8px;margin:2px 0;height:42px;transition:all .18s ease}.aside :deep(.el-menu-item:hover),.aside :deep(.el-sub-menu__title:hover){background:rgba(255,255,255,.07);color:#fff}.aside :deep(.el-sub-menu.is-opened>.el-sub-menu__title){color:#fff}.aside :deep(.el-menu-item.is-active){background:linear-gradient(90deg,rgba(48,86,211,.55),rgba(48,86,211,.28));color:#fff;font-weight:600;box-shadow:inset 3px 0 0 #7d96ee}.aside-foot{padding:14px 20px;font-size:11px;color:rgba(255,255,255,.28);letter-spacing:2px;border-top:1px solid rgba(255,255,255,.08)}.content-shell{min-width:0}.header{display:flex;align-items:center;background:rgba(255,255,255,.86);backdrop-filter:blur(8px);border-bottom:1px solid var(--re-border);height:56px}.page-title{font-weight:600;color:var(--re-text)}.header-right{margin-left:auto}.user-chip{display:flex;align-items:center;gap:10px;padding:4px 10px;border-radius:999px;cursor:pointer}.avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--re-primary),var(--re-ink-3));color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600}.user-meta{display:flex;flex-direction:column;line-height:1.2}.user-meta b{font-size:13px;color:var(--re-text)}.user-meta i{font-style:normal;font-size:11px;color:var(--re-text-3)}.tabs-bar{height:42px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#fff;border-bottom:1px solid var(--re-border)}.tabs-bar .el-scrollbar{flex:1}.tabs-list{display:flex;gap:8px;white-space:nowrap;padding:4px 0}.tabs-list .el-tag{cursor:pointer}.main{padding:24px;background:transparent;display:flex;flex-direction:column;min-height:0;overflow:auto}.page-enter{display:block;flex:1 0 auto;min-height:0}
</style>
