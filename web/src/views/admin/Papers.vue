<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>试卷管理</h2>
      <p class="desc">设置及格线、限时与补考次数，从审核通过的题库中组卷发布</p>
    </div>
    <div class="toolbar">
      <el-select v-model="query.regulation_id" placeholder="按制度筛选" clearable filterable style="width:260px" @change="load">
        <el-option v-for="r in regulations" :key="r.id" :label="r.title" :value="r.id" />
      </el-select>
      <el-select v-model="query.status" placeholder="状态" clearable style="width:140px" @change="load">
        <el-option label="草稿" value="draft" />
        <el-option label="已发布" value="published" />
        <el-option label="已归档" value="archived" />
      </el-select>
      <div style="flex:1" />
      <el-button type="primary" @click="createVisible = true">创建试卷</el-button>
    </div>

    <el-table v-loading="loading" :data="list">
      <el-table-column prop="title" label="试卷" min-width="220" />
      <el-table-column label="所属制度" min-width="180">
        <template #default="{ row }">{{ regTitle(row.regulation_id) }}</template>
      </el-table-column>
      <el-table-column label="及格线 / 限时 / 补考" width="190">
        <template #default="{ row }">{{ row.pass_score }} 分 · {{ row.duration_minutes }} 分钟 · {{ row.max_attempts }} 次</template>
      </el-table-column>
      <el-table-column prop="partial_credit_ratio" label="漏选部分分" width="100" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'published' ? 'success' : row.status === 'draft' ? 'info' : 'warning'">
            {{ ({ draft: '草稿', published: '已发布', archived: '已归档' } as any)[row.status] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" @click="$router.push(`/admin/papers/${row.id}`)">组卷</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination style="margin-top:16px; justify-content:flex-end" layout="total, prev, pager, next" :total="total"
      :page-size="query.page_size" v-model:current-page="query.page" @current-change="load" />

    <el-dialog v-model="createVisible" title="创建试卷" width="520px">
      <el-form label-width="120px">
        <el-form-item label="所属制度">
          <el-select v-model="createForm.regulation_id" filterable style="width:100%">
            <el-option v-for="r in regulations" :key="r.id" :label="r.title" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="试卷标题"><el-input v-model="createForm.title" /></el-form-item>
        <el-form-item label="及格线（0-100]"><el-input-number v-model="createForm.pass_score" :min="1" :max="100" /></el-form-item>
        <el-form-item label="限时（分钟）"><el-input-number v-model="createForm.duration_minutes" :min="1" :max="300" /></el-form-item>
        <el-form-item label="最大作答次数"><el-input-number v-model="createForm.max_attempts" :min="1" :max="10" /></el-form-item>
        <el-form-item label="多选漏选部分分">
          <el-input-number v-model="createForm.partial_credit_ratio" :min="0" :max="1" :step="0.1" />
          <span style="color:#909399; font-size:12px; margin-left:8px">默认 0.50</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="onCreate">创建（草稿）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../../api/http';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const regulations = ref<any[]>([]);
const query = reactive<any>({ page: 1, page_size: 20, regulation_id: '', status: '' });
const createVisible = ref(false);
const createForm = reactive<any>({ regulation_id: '', title: '', pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5 });

function regTitle(id: number) {
  return regulations.value.find((r) => r.id === id)?.title || '—';
}

async function load() {
  loading.value = true;
  try {
    const d: any = await http.get('/ai/papers', { params: query });
    list.value = d.list;
    total.value = d.total;
  } finally {
    loading.value = false;
  }
}

async function onCreate() {
  // 后端 DTO 要求 id 为字符串（bigint 序列化口径），下拉绑定的是数字，提交前显式转换
  const p: any = await http.post('/ai/papers', { ...createForm, regulation_id: String(createForm.regulation_id) });
  ElMessage.success('试卷已创建（草稿），请前往组卷');
  createVisible.value = false;
  await load();
  void p;
}

onMounted(async () => {
  const d: any = await http.get('/regulations', { params: { page_size: 100 } });
  regulations.value = d.list;
  await load();
});
</script>
