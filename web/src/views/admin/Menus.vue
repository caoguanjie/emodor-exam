<template>
  <section class="page-card">
    <FitsTable>
      <template #actions>
        <el-button @click="load">刷新</el-button><el-button v-if="canWrite" type="primary" @click="openCreate">新增节点</el-button>
      </template>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button link @click="load">重试</el-button></el-alert>
      <el-table v-loading="loading" :data="rows" row-key="id" :tree-props="{ children: 'children' }" default-expand-all empty-text="暂无菜单配置">
        <el-table-column prop="name" label="名称" min-width="180" />
        <el-table-column prop="type" label="类型" width="100"><template #default="{ row }">{{ typeLabel[row.type as MenuType] }}</template></el-table-column>
        <el-table-column prop="route_path" label="注册路由" min-width="210" show-overflow-tooltip />
        <el-table-column prop="permission_code" label="权限标识" min-width="190" show-overflow-tooltip />
        <el-table-column prop="sort" label="排序" width="80" />
        <el-table-column prop="status" label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="150" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </FitsTable>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑菜单节点' : '新增菜单节点'" width="600px" class="re-form-dialog" :before-close="beforeDialogClose">
      <el-form label-width="96px">
        <el-form-item label="名称"><el-input v-model="form.name" maxlength="128" /></el-form-item>
        <el-form-item label="类型"><el-radio-group v-model="form.type"><el-radio-button value="directory">目录</el-radio-button><el-radio-button value="menu">菜单</el-radio-button><el-radio-button value="button">按钮</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="上级节点"><el-tree-select v-model="form.parent_id" :data="parentOptions" clearable check-strictly node-key="value" :props="{ label: 'label', children: 'children' }" /></el-form-item>
        <el-form-item v-if="form.type === 'menu'" label="注册路由"><el-select v-model="form.route_path" filterable style="width:100%"><el-option v-for="path in routeOptions" :key="path" :label="path" :value="path" /></el-select></el-form-item>
        <el-form-item v-if="form.type !== 'directory'" label="权限标识"><el-select v-model="form.permission_code" clearable filterable style="width:100%"><el-option v-for="item in permissionOptions" :key="item.code" :label="`${item.name}（${item.code}）`" :value="item.code" /></el-select></el-form-item>
        <el-form-item label="图标"><el-input v-model="form.icon" placeholder="Element Plus 图标名，可留空" maxlength="64" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" :max="100000" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="closeDialog">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { FitsTable } from '../../components/FitsTable';
import { useAuthStore } from '../../stores/auth';
import { useUnsavedChanges } from '../../composables/useUnsavedChanges';

type MenuType = 'directory' | 'menu' | 'button';
interface MenuRow { id:string; parent_id:string|null; name:string; type:MenuType; route_path:string|null; permission_code:string|null; icon:string|null; sort:number; status:number; children:MenuRow[] }
interface TreeOption { value:string; label:string; children?:TreeOption[] }
interface MenuForm { id:string; parent_id:string|null; name:string; type:MenuType; route_path:string|null; permission_code:string|null; icon:string|null; sort:number; status:number }
const routeOptions = ['/admin/dashboard','/admin/students','/admin/training-categories','/admin/courses','/admin/questions','/admin/papers','/admin/questions/import','/admin/exam-records','/admin/training-statistics','/admin/ai-config','/admin/administrators','/admin/roles','/admin/sessions','/admin/system/menus','/admin/system/dictionaries','/admin/system/site-settings','/admin/system/audit-logs'];
const typeLabel: Record<MenuType,string> = { directory:'目录', menu:'菜单', button:'按钮' };
const auth = useAuthStore();
const canWrite = computed(() => auth.can('system_settings:write'));
const rows = ref<MenuRow[]>([]); const loading = ref(false); const saving = ref(false); const error = ref(''); const dialogVisible = ref(false); const dirty = ref(false);
const permissionOptions = ref<{code:string;name:string}[]>([]);
const form = reactive<MenuForm>({ id:'', parent_id:null, name:'', type:'menu', route_path:null, permission_code:null, icon:null, sort:0, status:1 });
let formBaseline:MenuForm={...form};
const unsaved = useUnsavedChanges(dirty,{onDiscard:discardForm});
watch(form, () => { if (dialogVisible.value) dirty.value=JSON.stringify(form)!==JSON.stringify(formBaseline); }, { deep:true });

const parentOptions = computed<TreeOption[]>(() => {
  const convert = (items:MenuRow[]):TreeOption[] => items.filter((item) => item.type !== 'button' && item.id !== form.id).map((item) => ({ value:item.id, label:item.name, children:convert(item.children || []) }));
  return convert(rows.value);
});

async function load() { loading.value=true; error.value=''; try { rows.value = await http.get('/admin/menus') as MenuRow[]; if(canWrite.value){try { permissionOptions.value = await http.get('/admin/menus/permission-options') as {code:string;name:string}[]; } catch { permissionOptions.value=[]; }}else{permissionOptions.value=[];} } catch (e:any) { error.value=e?.message || '菜单加载失败'; } finally { loading.value=false; } }
function reset(row?:MenuRow) { formBaseline=row?{id:row.id,parent_id:row.parent_id,name:row.name,type:row.type,route_path:row.route_path,permission_code:row.permission_code,icon:row.icon,sort:row.sort,status:row.status}:{id:'',parent_id:null,name:'',type:'menu',route_path:null,permission_code:null,icon:null,sort:0,status:1};Object.assign(form,formBaseline);dirty.value=false; }
function discardForm(){dialogVisible.value=false;Object.assign(form,formBaseline);dirty.value=false}
function openCreate(){ reset(); dialogVisible.value=true; dirty.value=false; }
function openEdit(row:MenuRow){ reset(row); dialogVisible.value=true; dirty.value=false; }
async function beforeDialogClose(done:()=>void){ if(await unsaved.confirmDiscard()){ dialogVisible.value=false; done(); } }
async function closeDialog(){ if(await unsaved.confirmDiscard()) dialogVisible.value=false; }
async function save(){
  if(!form.name.trim()){ ElMessage.warning('请输入菜单名称'); return; }
  const payload = { parent_id:form.parent_id || null,name:form.name.trim(),type:form.type,route_path:form.type==='menu'?form.route_path:null,permission_code:form.type==='directory'?null:form.permission_code,icon:form.icon || null,sort:form.sort,status:form.status };
  saving.value=true; try { if(form.id) await http.put(`/admin/menus/${form.id}`,payload); else await http.post('/admin/menus',payload); dirty.value=false; dialogVisible.value=false; ElMessage.success('菜单已保存'); await load(); } finally { saving.value=false; }
}
async function remove(row:MenuRow){ try { await ElMessageBox.confirm(`确定删除“${row.name}”吗？存在子项或角色引用时服务端会拒绝。`,'删除菜单',{type:'warning'}); await http.delete(`/admin/menus/${row.id}`); ElMessage.success('已删除'); await load(); } catch(e:any){ if(e !== 'cancel' && e !== 'close' && e?.message) error.value=e.message; } }
void load();
</script>

<style scoped>
.page-card{background:#fff;border:1px solid var(--re-border);border-radius:12px;padding:20px;min-height:420px}
</style>
