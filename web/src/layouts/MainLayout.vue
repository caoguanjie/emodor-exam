<template>
  <el-container class="shell">
    <el-aside :width="sidebarCollapsed ? '68px' : '232px'" class="aside" :class="{ 'is-collapsed': sidebarCollapsed }">
      <div class="logo">
        <img class="logo-badge" :src="logoSrc" alt="海珠区安全教育培训中心 Logo" />
        <div class="logo-text"><span class="logo-name">海珠区安全教育培训中心</span><span class="logo-sub">安全教育培训与考试平台</span></div>
      </div>
      <el-scrollbar class="nav-scroll">
        <!-- ElMenu reads default-openeds at mount; wait for asynchronous admin navigation. -->
        <el-menu v-if="!auth.isAdmin || adminGroups.length > 0" :default-active="route.path" :default-openeds="defaultOpeneds" :collapse="sidebarCollapsed" :collapse-transition="false" router class="nav-menu">
          <template v-if="auth.isAdmin">
            <template v-for="group in adminGroups" :key="group.name">
              <el-menu-item v-if="group.path" :index="group.path">
                <el-icon v-if="iconFor(group.icon)"><component :is="iconFor(group.icon)" /></el-icon><span>{{ group.name }}</span>
              </el-menu-item>
              <el-sub-menu v-else :index="group.id">
                <template #title><el-icon v-if="iconFor(group.icon)"><component :is="iconFor(group.icon)" /></el-icon><span>{{ group.name }}</span></template>
                <el-menu-item v-for="item in group.items" :key="item.path" :index="item.path">
                  <el-icon v-if="iconFor(item.icon)"><component :is="iconFor(item.icon)" /></el-icon><span>{{ item.name }}</span>
                </el-menu-item>
              </el-sub-menu>
            </template>
          </template>
          <template v-else>
            <li class="nav-group">我的学习</li>
            <el-menu-item index="/my/regulations"><el-icon><Reading /></el-icon><span>我的制度</span></el-menu-item>
            <el-menu-item index="/my/scores"><el-icon><Medal /></el-icon><span>我的成绩</span></el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>
      <div class="aside-foot">学习留痕 · 服务端计时</div>
    </el-aside>
    <el-container class="content-shell">
      <el-header class="header">
        <div class="header-start">
          <button
            type="button"
            class="sidebar-toggle"
            :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
            :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
            @click="toggleSidebar"
          >
            <svg class="sidebar-toggle__icon" :class="{ 'is-expanded': !sidebarCollapsed }" viewBox="0 0 1024 1024" aria-hidden="true">
              <path d="M408 442h480c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H408c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8zm-8 204c0 4.4 3.6 8 8 8h480c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H408c-4.4 0-8 3.6-8 8v56zm504-486H120c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zm0 632H120c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM142.4 642.1 298.7 519a8.84 8.84 0 0 0 0-13.9L142.4 381.9c-5.8-4.6-14.4-.5-14.4 6.9v246.3a8.9 8.9 0 0 0 14.4 7z" />
            </svg>
          </button>
          <span class="page-title">{{ route.meta.title || '海珠区安全教育培训中心' }}</span>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click" @command="onUserCommand">
            <div class="user-chip"><span class="avatar">{{ avatarChar }}</span><span class="user-meta"><b>{{ auth.user?.real_name }}</b><i>{{ roleLabel }}</i></span></div>
            <template #dropdown><el-dropdown-menu><el-dropdown-item command="profile">本人资料</el-dropdown-item><el-dropdown-item command="password">修改密码</el-dropdown-item><el-dropdown-item divided command="logout">退出登录</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown>
        </div>
      </el-header>
      <BusinessTabs
        :items="tabs.tabs"
        :active-path="route.fullPath"
        :home-path="homePath"
        @activate="router.push($event)"
        @close="closeTab"
        @action="onTabCommand"
      />
      <div class="content-region">
        <div ref="contentDialogTarget" class="content-dialog-host" />
        <el-main class="main">
          <router-view v-slot="{ Component, route: viewRoute }">
            <KeepAlive :max="20">
              <component v-if="viewRoute.meta.cache" :is="Component" :key="tabCacheKey(viewRoute.fullPath, cacheVersions)" class="page-enter" />
            </KeepAlive>
            <component v-if="!viewRoute.meta.cache" :is="Component" :key="tabCacheKey(viewRoute.fullPath, cacheVersions)" class="page-enter" />
          </router-view>
        </el-main>
      </div>
    </el-container>

    <el-dialog v-model="profileVisible" title="本人资料" width="560px" class="re-form-dialog" :before-close="beforeProfileClose">
      <el-form label-width="90px" v-loading="profileLoading">
        <el-form-item label="头像"><MediaUpload v-model="profile.avatar_id" purpose="avatar" :owner-id="String(auth.user?.id || '')" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="profile.real_name" maxlength="64" /></el-form-item>
        <el-form-item label="手机"><el-input v-model="profile.phone" maxlength="32" disabled /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="profile.email" maxlength="128" /></el-form-item>
        <el-form-item label="学员属性"><span>{{ profile.source || '—' }} / 类别 {{ profile.category_id || '—' }}</span></el-form-item>
      </el-form>
      <template #footer><el-button @click="closeProfile">取消</el-button><el-button type="primary" :loading="profileSaving" @click="saveProfile">保存</el-button></template>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, provide, reactive, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  AlarmClock, CollectionTag, Cpu, DataAnalysis, Document, DocumentChecked, EditPen,
  Grid, Menu as MenuIcon, Medal, Monitor, Notebook, OfficeBuilding,
  Picture, Reading, Setting, SetUp, Tickets, User, UserFilled,
} from '@element-plus/icons-vue';
import http, { publicSiteAssetUrl } from '../api/http';
import MediaUpload from '../components/MediaUpload.vue';
import BusinessTabs from '../components/BusinessTabs.vue';
import { confirmAllUnsavedChanges, confirmUnsavedChanges, useUnsavedChanges } from '../composables/useUnsavedChanges';
import { useAuthStore } from '../stores/auth';
import { useTabsStore } from '../stores/tabs';
import { invalidateTabCache, tabCacheKey, type TabCacheVersions } from '../stores/tab-cache';
import { defaultHomePath, routeAccessAllowed } from '../router/access';
import defaultBrandLogo from '../assets/brand-logo.png';

interface NavigationNode { id:string; name:string; type:'directory'|'menu'|'button'; route_path:string|null; permission_code:string|null; icon:string|null; status:number; children:NavigationNode[] }
interface NavigationItem { name:string; path:string; icon:string|null }
interface NavigationGroup { id:string; name:string; path:string|null; icon:string|null; items:NavigationItem[] }
interface SiteConfig { logo_asset_id:string|null }
interface ProfileData { real_name:string; phone:string; email:string; avatar_id:string|null; source:string|null; category_id:string|null }
const route=useRoute(); const router=useRouter(); const auth=useAuthStore(); const tabs=useTabsStore(); const cacheVersions=reactive<TabCacheVersions>({}); const adminGroups=ref<NavigationGroup[]>([]); const siteConfig=reactive<SiteConfig>({logo_asset_id:null});
const contentDialogTarget = ref<HTMLElement>();
provide('contentDialogTarget', contentDialogTarget);
const SIDEBAR_STORAGE_KEY='re_sidebar_collapsed';
function restoreSidebarCollapsed(){try{return window.localStorage?.getItem(SIDEBAR_STORAGE_KEY)==='1'}catch{return false}}
const sidebarCollapsed=ref(restoreSidebarCollapsed());
const profileVisible=ref(false);const profileLoading=ref(false);const profileSaving=ref(false);const profileDirty=ref(false);let applyingProfile=false;const profile=reactive<ProfileData>({real_name:'',phone:'',email:'',avatar_id:null,source:null,category_id:null});
let profileBaseline:ProfileData={...profile};
const profileRouteKey=computed(()=>route.fullPath);
const profileUnsaved=useUnsavedChanges(profileDirty,{routeKey:profileRouteKey,onDiscard:discardProfile});

const iconMap:Record<string,Component>={AlarmClock,CollectionTag,Cpu,DataAnalysis,Document,DocumentChecked,EditPen,Grid,Menu:MenuIcon,Medal,Monitor,Notebook,OfficeBuilding,Picture,Reading,Setting,SetUp,Tickets,User,UserFilled};
const iconFor=(name:string|null)=>name?iconMap[name]||Setting:null;
const roleLabel=computed(()=>auth.user?.role==='super_admin'?'超级管理员':auth.user?.role==='regulation_admin'||auth.user?.permissions?.length?'业务管理员':'学员');
const avatarChar=computed(()=>(auth.user?.real_name||'用').slice(0,1));
const logoSrc=computed(()=>siteConfig.logo_asset_id?publicSiteAssetUrl(siteConfig.logo_asset_id):defaultBrandLogo);
const defaultOpeneds=computed(()=>adminGroups.value.filter(group=>!group.path&&group.name!=='系统设置').map(group=>group.id));
const homePath=computed(()=>defaultHomePath(auth.isAdmin));

function routeAllowed(path:string){const resolved=router.resolve(path);if(!resolved.matched.length||resolved.matched.some(record=>record.path.includes(':pathMatch')))return false;return routeAccessAllowed(resolved.meta,auth.can,auth.isSuperAdmin)}
const examMenuOrder=new Map([
  ['/admin/questions',10],
  ['/admin/papers',20],
  ['/admin/questions/import',30],
  ['/admin/exam-records',40],
]);
function normalizeNavigation(nodes:NavigationNode[]){return nodes.map(root=>{
  if(root.type!=='directory'||root.name!=='考试管理')return root;
  const children=(root.children||[]).map(item=>item.route_path==='/admin/questions'?{...item,name:'试题管理'}:item);
  if(!children.some(item=>item.route_path==='/admin/questions/import'))children.push({id:'compat-question-import',name:'试题导入',type:'menu',route_path:'/admin/questions/import',permission_code:'questions:write',icon:'Upload',status:1,children:[]});
  children.sort((left,right)=>(examMenuOrder.get(left.route_path||'')??1000)-(examMenuOrder.get(right.route_path||'')??1000));
  return{...root,children};
})}
function flattenMenus(nodes:NavigationNode[], output:NavigationItem[]=[]){for(const node of nodes){if(!node.status)continue;if(node.type==='menu'&&node.route_path&&routeAllowed(node.route_path))output.push({name:node.name,path:node.route_path,icon:node.icon});if(node.children?.length)flattenMenus(node.children,output)}return output}
async function loadNavigation(){if(!auth.isAdmin){adminGroups.value=[];return}try{const roots=normalizeNavigation(await http.get('/admin/menus/navigation') as NavigationNode[]);adminGroups.value=roots.filter(root=>root.status).map(root=>{const directPath=root.type==='menu'&&root.route_path&&routeAllowed(root.route_path)?root.route_path:null;return{id:String(root.id),name:root.name,path:directPath,icon:root.icon,items:directPath?[]:flattenMenus(root.children||[])}}).filter(group=>!!group.path||group.items.length>0)}catch{adminGroups.value=[]}}
async function loadSiteConfig(){try{const value=await http.get('/site-config') as SiteConfig;siteConfig.logo_asset_id=value.logo_asset_id||null}catch{/* bundled logo remains */}}
function toggleSidebar(){sidebarCollapsed.value=!sidebarCollapsed.value;try{window.localStorage?.setItem(SIDEBAR_STORAGE_KEY,sidebarCollapsed.value?'1':'0')}catch{/* layout preference stays in memory */}}

watch(()=>route.fullPath,()=>{tabs.visit(route.fullPath,String(route.meta.title||'未命名页面'))},{immediate:true});
watch(profile,()=>{if(profileVisible.value&&!applyingProfile)profileDirty.value=true},{deep:true});

async function closeTab(path:string){
  if(path===homePath.value||!tabs.tabs.some(tab=>tab.path===path&&tab.closable!==false))return;
  const active=route.fullPath===path;
  const result=await tabs.close(path,homePath.value);
  if(!result.closed)return;
  if(active)await router.push(result.nextPath||homePath.value);
  invalidateTabCache(cacheVersions,[path]);
}
async function onTabCommand(command:string){
  if(command==='refresh'){
    if(await confirmUnsavedChanges(route.fullPath))invalidateTabCache(cacheVersions,[route.fullPath]);
    return;
  }
  if(command==='current'){await closeTab(route.fullPath);return}
  const visible=tabs.tabs.filter(tab=>tab.path!==homePath.value);
  const activeIndex=visible.findIndex(tab=>tab.path===route.fullPath);
  let candidates=visible;
  if(command==='others')candidates=visible.filter(tab=>tab.path!==route.fullPath);
  else if(command==='left')candidates=activeIndex<0?[]:visible.slice(0,activeIndex);
  else if(command==='right')candidates=route.fullPath===homePath.value?visible:activeIndex<0?[]:visible.slice(activeIndex+1);
  else if(command!=='all')return;
  const removed=candidates.filter(tab=>tab.closable!==false).map(tab=>tab.path);
  if(!await tabs.closePaths(removed))return;
  if(command==='all'){
    await router.push(homePath.value);
    invalidateTabCache(cacheVersions,removed);
    return;
  }
  invalidateTabCache(cacheVersions,removed);
  if(removed.includes(route.fullPath)){
    const remaining=tabs.tabs.filter(tab=>tab.path!==homePath.value);
    await router.push(remaining[Math.min(Math.max(activeIndex,0),remaining.length-1)]?.path||homePath.value);
  }
}
function normalizeProfile(value:any):ProfileData{return{real_name:value.real_name||'',phone:value.phone||'',email:value.email||'',avatar_id:value.avatar_id?String(value.avatar_id):null,source:value.source||null,category_id:value.category_id?String(value.category_id):null}}
function applyProfile(value:any){applyingProfile=true;const normalized=normalizeProfile(value);Object.assign(profile,normalized);profileBaseline={...normalized};profileDirty.value=false;queueMicrotask(()=>{applyingProfile=false})}
function discardProfile(){applyingProfile=true;Object.assign(profile,profileBaseline);profileDirty.value=false;profileVisible.value=false;queueMicrotask(()=>{applyingProfile=false})}
async function confirmProfileDiscard(){return profileUnsaved.confirmDiscard()}
async function beforeProfileClose(done:()=>void){if(await confirmProfileDiscard()){profileVisible.value=false;done()}} async function closeProfile(){if(await confirmProfileDiscard())profileVisible.value=false}
async function openProfile(){profileVisible.value=true;profileLoading.value=true;try{applyProfile(await http.get('/me/profile'))}finally{profileLoading.value=false}}
async function saveProfile(){profileSaving.value=true;try{await http.patch('/me/profile',{real_name:profile.real_name,email:profile.email||null,avatar_id:profile.avatar_id});profileBaseline={...profile};profileDirty.value=false;profileVisible.value=false;await auth.fetchProfile();ElMessage.success('本人资料已保存')}finally{profileSaving.value=false}}
async function onLogout(){try{await ElMessageBox.confirm('确定退出当前账号吗？','退出登录',{type:'warning'})}catch{return}if(!await confirmAllUnsavedChanges())return;await auth.logout();tabs.reset();await router.push('/login')}
function onUserCommand(command:string){if(command==='profile')void openProfile();else if(command==='password')void router.push('/change-password');else if(command==='logout')void onLogout()}

onMounted(()=>{void loadNavigation();void loadSiteConfig()});
</script>

<style scoped>
.shell{height:100%}.aside{background:linear-gradient(180deg,var(--re-ink) 0%,#101b36 100%);display:flex;flex-direction:column;overflow:hidden;transition:width .25s ease}.logo{display:flex;align-items:center;gap:10px;padding:20px 20px 16px}.logo-badge{width:36px;height:36px;border-radius:9px;object-fit:cover;flex:none}.logo-text{display:flex;flex-direction:column;line-height:1.25;min-width:0}.logo-name{color:#fff;font-size:12px;font-weight:700;letter-spacing:-0.2px;white-space:nowrap}.logo-sub{color:rgba(255,255,255,.45);font-size:10px;white-space:nowrap}.nav-scroll{flex:1}.nav-group{list-style:none;margin:18px 20px 6px;font-size:11px;color:rgba(255,255,255,.38);letter-spacing:3px;font-weight:600}.aside :deep(.el-menu){width:100%;box-sizing:border-box;border-right:none;background:transparent;padding:0 10px}.aside :deep(.el-menu-item),.aside :deep(.el-sub-menu__title){color:rgba(255,255,255,.68);border-radius:8px;margin:2px 0;height:42px;transition:all .18s ease}.aside :deep(.el-menu-item:hover),.aside :deep(.el-sub-menu__title:hover){background:rgba(255,255,255,.07);color:#fff}.aside :deep(.el-sub-menu.is-opened>.el-sub-menu__title){color:#fff}.aside :deep(.el-menu-item.is-active){background:linear-gradient(90deg,rgba(48,86,211,.55),rgba(48,86,211,.28));color:#fff;font-weight:600;box-shadow:inset 3px 0 0 #7d96ee}.aside-foot{padding:14px 20px;font-size:11px;color:rgba(255,255,255,.28);letter-spacing:2px;border-top:1px solid rgba(255,255,255,.08)}.aside.is-collapsed .logo{justify-content:center;padding:20px 0 16px}.aside.is-collapsed .logo-text,.aside.is-collapsed .aside-foot,.aside.is-collapsed .nav-group{display:none}.aside.is-collapsed :deep(.el-menu){padding:0 4px}.aside.is-collapsed :deep(.el-menu--collapse>.el-menu-item),.aside.is-collapsed :deep(.el-menu--collapse>.el-sub-menu>.el-sub-menu__title){display:flex;width:60px;height:60px;margin:2px 0;padding:0!important;flex-flow:column;align-items:center;justify-content:center;line-height:1}.aside.is-collapsed :deep(.el-menu--collapse>.el-menu-item>.el-icon),.aside.is-collapsed :deep(.el-menu--collapse>.el-sub-menu>.el-sub-menu__title>.el-icon){margin:0!important;font-size:18px}.aside.is-collapsed :deep(.el-menu--collapse>.el-menu-item>span),.aside.is-collapsed :deep(.el-menu--collapse>.el-sub-menu>.el-sub-menu__title>span){display:inline-block!important;visibility:visible!important;width:auto!important;max-width:56px;height:auto!important;margin-top:8px;font-size:12px;line-height:1;white-space:nowrap}.aside.is-collapsed :deep(.el-sub-menu__icon-arrow){display:none}.aside.is-collapsed :deep(.el-sub-menu.is-active>.el-sub-menu__title){background:linear-gradient(180deg,rgba(48,86,211,.48),rgba(48,86,211,.24));color:#fff;box-shadow:inset 3px 0 0 #7d96ee}.content-shell{min-width:0}.header{display:flex;align-items:center;background:rgba(255,255,255,.86);backdrop-filter:blur(8px);border-bottom:1px solid var(--re-border);height:56px}.header-start{display:flex;align-items:center;height:100%;min-width:0}.sidebar-toggle{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;margin:0 10px 0 -8px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--re-text);cursor:pointer}.sidebar-toggle:hover{background:var(--re-bg)}.sidebar-toggle__icon{width:20px;height:20px;fill:currentColor;transition:transform .25s ease}.sidebar-toggle__icon.is-expanded{transform:rotate(180deg)}.page-title{margin:0;line-height:1;font-weight:600;color:var(--re-text)}.header-right{margin-left:auto}.user-chip{display:flex;align-items:center;gap:10px;padding:4px 10px;border-radius:999px;cursor:pointer}.avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--re-primary),var(--re-ink-3));color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600}.user-meta{display:flex;flex-direction:column;line-height:1.2}.user-meta b{font-size:13px;color:var(--re-text)}.user-meta i{font-style:normal;font-size:11px;color:var(--re-text-3)}.main{padding:24px;background:transparent;display:flex;flex-direction:column;min-height:0;overflow:auto}.page-enter{display:block;flex:1 0 auto;min-height:0}
.main{padding:16px}
</style>
