<template>
  <section class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch>
          <el-form-item label="日期"><el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期"/></el-form-item>
          <el-form-item label="操作人"><el-input v-model="query.actor" clearable/></el-form-item>
          <el-form-item label="动作"><el-input v-model="query.action" clearable placeholder="如 system.menu" @keyup.enter="search"/></el-form-item>
          <template #actions><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></template>
        </FitsListSearch>
      </template>
      <template #actions><el-button @click="load">刷新</el-button></template>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button link @click="load">重试</el-button></el-alert>
      <el-table v-loading="loading" :data="items" empty-text="暂无审计记录"><el-table-column prop="ts" label="时间" min-width="175"><template #default="{row}">{{formatTime(row.ts)}}</template></el-table-column><el-table-column prop="actor_name" label="操作人" min-width="120"/><el-table-column prop="action" label="动作" min-width="190" show-overflow-tooltip/><el-table-column prop="object_type" label="对象" min-width="130"/><el-table-column prop="object_id" label="对象 ID" min-width="100"/><el-table-column label="结果" width="90"><template #default="{row}"><el-tag :type="row.result==='success'?'success':'danger'">{{row.result==='success'?'成功':'失败'}}</el-tag></template></el-table-column><el-table-column prop="source_ip" label="来源 IP" min-width="120"/><el-table-column label="详情" min-width="260"><template #default="{row}"><code>{{JSON.stringify(row.detail)}}</code></template></el-table-column></el-table>
      <template #pagination><el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" :total="total" :page-sizes="[20,50,100]" layout="total, sizes, prev, pager, next" @change="load"/></template>
    </FitsTable>
  </section>
</template>
<script setup lang="ts">
import { FitsTable, FitsListSearch } from '../../components/FitsTable';
import { reactive, ref } from 'vue'; import http from '../../api/http';
interface AuditRow{ts:string;actor_id:string|number|null;actor_name:string;action:string;object_type:string;object_id:string|number|null;detail:Record<string,unknown>;result:'success'|'failure';source_ip:string|null}
const items=ref<AuditRow[]>([]);const total=ref(0);const loading=ref(false);const error=ref('');const dates=ref<string[]>([]);const query=reactive({actor:'',action:'',page:1,page_size:20});
async function load(){loading.value=true;error.value='';try{const data:any=await http.get('/admin/audit-logs',{params:{date_from:dates.value?.[0],date_to:dates.value?.[1],actor:query.actor||undefined,action:query.action||undefined,page:query.page,page_size:query.page_size}});items.value=data.items;total.value=data.total}catch(e:any){error.value=e?.message||'审计日志加载失败'}finally{loading.value=false}}
function search(){query.page=1;void load()} function reset(){dates.value=[];Object.assign(query,{actor:'',action:'',page:1,page_size:20});void load()} function formatTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString()}
void load();
</script>
<style scoped>.page-card{background:#fff;border:1px solid var(--re-border);border-radius:12px;padding:20px;min-height:420px}code{white-space:normal;word-break:break-all;color:var(--re-text-2)}</style>
