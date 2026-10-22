<template>
  <section class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch>
          <el-form-item label="类型"><el-input v-model="query.type" clearable /></el-form-item>
          <el-form-item label="关键词"><el-input v-model="query.keyword" clearable @keyup.enter="search" /></el-form-item>
          <template #actions><el-button type="primary" @click="search">查询</el-button><el-button @click="resetQuery">重置</el-button></template>
        </FitsListSearch>
      </template>
      <template v-if="canWrite" #actions><el-button type="primary" @click="openCreate">新增字典项</el-button></template>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button link @click="load">重试</el-button></el-alert>
      <el-table v-loading="loading" :data="items" empty-text="暂无字典项">
        <el-table-column prop="type" label="类型" min-width="150"/><el-table-column prop="code" label="编码" min-width="140"/><el-table-column prop="label" label="显示名称" min-width="150"/><el-table-column prop="sort" label="排序" width="80"/>
        <el-table-column label="属性" width="100"><template #default="{row}"><el-tag :type="row.is_system?'warning':'info'">{{row.is_system?'固定':'自定义'}}</el-tag></template></el-table-column>
        <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.status?'success':'info'">{{row.status?'启用':'停用'}}</el-tag></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="150"><template #default="{row}"><el-button link type="primary" :disabled="row.is_system" @click="openEdit(row)">编辑</el-button><el-button link type="danger" :disabled="row.is_system" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
      <template #pagination><el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[10,20,50,100]" layout="total, sizes, prev, pager, next" @change="load"/></template>
    </FitsTable>
    <el-dialog v-model="dialogVisible" :title="form.id?'编辑字典项':'新增字典项'" width="520px" class="re-form-dialog" :before-close="beforeDialogClose">
      <el-form label-width="90px"><el-form-item label="类型"><el-input v-model="form.type" maxlength="64"/></el-form-item><el-form-item label="编码"><el-input v-model="form.code" maxlength="64"/></el-form-item><el-form-item label="显示名称"><el-input v-model="form.label" maxlength="128"/></el-form-item><el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" :max="100000"/></el-form-item><el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0"/></el-form-item><el-form-item label="备注"><el-input v-model="form.remark" maxlength="255"/></el-form-item></el-form>
      <template #footer><el-button @click="closeDialog">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { FitsTable, FitsListSearch } from '../../components/FitsTable';
import { computed, reactive, ref, watch } from 'vue'; import { ElMessage, ElMessageBox } from 'element-plus'; import http from '../../api/http'; import { useAuthStore } from '../../stores/auth'; import { useUnsavedChanges } from '../../composables/useUnsavedChanges';
interface DictionaryRow{id:string;type:string;code:string;label:string;sort:number;status:number;is_system:boolean;remark:string|null}
interface DictionaryForm{id:string;type:string;code:string;label:string;sort:number;status:number;remark:string}
const auth=useAuthStore(); const canWrite=computed(()=>auth.can('system_settings:write')); const items=ref<DictionaryRow[]>([]); const total=ref(0); const loading=ref(false); const saving=ref(false); const error=ref(''); const dialogVisible=ref(false); const dirty=ref(false); const query=reactive({page:1,page_size:20,type:'',keyword:''}); const form=reactive<DictionaryForm>({id:'',type:'',code:'',label:'',sort:0,status:1,remark:''}); let formBaseline:DictionaryForm={...form}; const unsaved=useUnsavedChanges(dirty,{onDiscard:discardForm}); watch(form,()=>{if(dialogVisible.value)dirty.value=JSON.stringify(form)!==JSON.stringify(formBaseline)},{deep:true});
async function load(){loading.value=true;error.value='';try{const data:any=await http.get('/admin/dictionaries',{params:{page:query.page,page_size:query.page_size,type:query.type||undefined,keyword:query.keyword||undefined}});items.value=data.items;total.value=data.total;}catch(e:any){error.value=e?.message||'字典加载失败';}finally{loading.value=false}}
function search(){query.page=1;void load()} function resetQuery(){Object.assign(query,{page:1,page_size:20,type:'',keyword:''});void load()}
function reset(row?:DictionaryRow){formBaseline=row?{id:row.id,type:row.type,code:row.code,label:row.label,sort:row.sort,status:row.status,remark:row.remark||''}:{id:'',type:'',code:'',label:'',sort:0,status:1,remark:''};Object.assign(form,formBaseline);dirty.value=false} function discardForm(){dialogVisible.value=false;Object.assign(form,formBaseline);dirty.value=false} function openCreate(){reset();dialogVisible.value=true;dirty.value=false} function openEdit(row:DictionaryRow){reset(row);dialogVisible.value=true;dirty.value=false}
async function beforeDialogClose(done:()=>void){if(await unsaved.confirmDiscard()){dialogVisible.value=false;done()}} async function closeDialog(){if(await unsaved.confirmDiscard())dialogVisible.value=false}
async function save(){saving.value=true;try{const payload={type:form.type.trim(),code:form.code.trim(),label:form.label.trim(),sort:form.sort,status:form.status,remark:form.remark.trim()||null};if(form.id)await http.put(`/admin/dictionaries/${form.id}`,payload);else await http.post('/admin/dictionaries',payload);dirty.value=false;dialogVisible.value=false;ElMessage.success('字典项已保存');await load()}finally{saving.value=false}}
async function remove(row:DictionaryRow){try{await ElMessageBox.confirm(`确定删除“${row.label}”吗？业务引用或固定枚举会被服务端拒绝。`,'删除字典项',{type:'warning'});await http.delete(`/admin/dictionaries/${row.id}`);ElMessage.success('已删除');await load()}catch(e:any){if(e!=='cancel'&&e!=='close'&&e?.message)error.value=e.message}}
void load();
</script>
<style scoped>.page-card{background:#fff;border:1px solid var(--re-border);border-radius:12px;padding:20px;min-height:420px}</style>
