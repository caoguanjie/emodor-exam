<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>制度管理</h2>
      <p class="desc">上传制度文件、配置学习要求与发布范围，发布后进入员工学习清单</p>
    </div>
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="制度标题" style="width:200px" clearable @keyup.enter="load" />
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width:140px" @change="load">
        <el-option label="草稿" value="draft" />
        <el-option label="已发布" value="published" />
        <el-option label="已归档" value="archived" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <div style="flex:1" />
      <el-button type="primary" @click="dialog = true">新建制度</el-button>
    </div>

    <el-table v-loading="loading" :data="list">
      <el-table-column prop="title" label="制度标题" min-width="240" />
      <el-table-column prop="category" label="分类" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="学习要求" width="150">
        <template #default="{ row }">≥ {{ row.required_minutes }} 分钟 · {{ row.scroll_segments }} 段</template>
      </el-table-column>
      <el-table-column label="发布时间" min-width="150">
        <template #default="{ row }">{{ formatDateTime(row.published_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" @click="$router.push(`/admin/regulations/${row.id}`)">管理</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next" :total="total"
      :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <el-dialog v-model="dialog" title="新建制度" width="480px">
      <el-form label-width="80px">
        <el-form-item label="标题"><el-input v-model="form.title" maxlength="128" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="form.category" maxlength="32" placeholder="如：安全类 / 人事类" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" maxlength="512" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="onCreate">创建（草稿）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../../api/http';
import { formatDateTime } from '../../utils/format';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const dialog = ref(false);
const form = reactive<any>({ title: '', category: '', description: '' });
const query = reactive<any>({ page: 1, page_size: 20, keyword: '', status: '' });

function statusLabel(s: string) {
  return ({ draft: '草稿', published: '已发布', archived: '已归档' } as any)[s] || s;
}
function statusType(s: string) {
  return ({ draft: 'info', published: 'success', archived: 'warning' } as any)[s] || 'info';
}

async function load() {
  loading.value = true;
  try {
    const d: any = await http.get('/regulations', { params: query });
    list.value = d.list;
    total.value = d.total;
  } finally {
    loading.value = false;
  }
}

async function onCreate() {
  await http.post('/regulations', form);
  ElMessage.success('制度已创建（草稿），请上传文件并完成配置');
  dialog.value = false;
  form.title = '';
  form.category = '';
  form.description = '';
  await load();
}

onMounted(load);
</script>
