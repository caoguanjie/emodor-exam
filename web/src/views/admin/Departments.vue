<template>
  <div class="page-card">
    <div class="page-head">
      <div class="eyebrow">管理台</div>
      <h2>部门管理</h2>
      <p class="desc">部门是发布范围圈定与统计维度的组织基础</p>
    </div>
    <div class="toolbar">
      <el-button v-if="auth.can('departments:write')" type="primary" @click="openCreate(null)">新建根级部门</el-button>
      <span style="color:#909399; font-size:13px">停用部门保留为历史统计维度，删除受引用约束</span>
    </div>
    <el-tree :data="tree" node-key="id" default-expand-all :expand-on-click-node="false">
      <template #default="{ data }">
        <div class="node-row">
          <span>
            {{ data.name }}
            <el-tag v-if="data.status === 0" size="small" type="info">已停用</el-tag>
            <el-tag v-else-if="data.id === '1'" size="small">根</el-tag>
          </span>
          <span class="node-actions">
            <template v-if="auth.can('departments:write')">
              <el-button text size="small" type="primary" @click="openCreate(data)">添加子部门</el-button>
              <el-button text size="small" @click="openEdit(data)">编辑</el-button>
              <el-button text size="small" type="warning" @click="openMove(data)">移动</el-button>
              <el-button v-if="data.status === 0" text size="small" type="success" @click="onEnable(data)">启用</el-button>
              <el-button text size="small" type="danger" @click="onDelete(data)">删除</el-button>
            </template>
          </span>
        </div>
      </template>
    </el-tree>

    <el-dialog v-model="dialog" :title="form.id ? '编辑部门' : '新建部门'" width="420px">
      <el-form label-width="90px">
        <el-form-item label="上级部门"><el-input :value="form.parentName || '（根部门）'" disabled /></el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" maxlength="64" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
        <el-form-item v-if="form.id" label="移动至">
          <el-tree-select v-model="form.parentId" :data="moveTree" check-strictly clearable placeholder="保持不变则留空" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button v-if="auth.can('departments:write')" type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../../api/http';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const tree = ref<any[]>([]);
const dialog = ref(false);
const form = reactive<any>({ id: null, parentId: null, parentName: '', name: '', sort: 0 });
const moveTree = ref<any[]>([]);

function toTreeData(nodes: any[]): any[] {
  return nodes.map((n) => ({ value: n.id, label: n.name, children: n.children?.length ? toTreeData(n.children) : undefined }));
}

async function load() {
  const d: any = await http.get('/departments/tree');
  tree.value = d.list;
  moveTree.value = toTreeData(d.list);
}

function findNode(nodes: any[], id: string): any {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

function openCreate(parent: any) {
  Object.assign(form, { id: null, parentId: parent?.id ?? null, parentName: parent?.name ?? '', name: '', sort: 0 });
  dialog.value = true;
}

function openEdit(node: any) {
  Object.assign(form, { id: node.id, parentId: node.parent_id, parentName: '', name: node.name, sort: node.sort });
  dialog.value = true;
}

function openMove(node: any) {
  Object.assign(form, { id: node.id, parentId: node.parent_id, parentName: '', name: node.name, sort: node.sort });
  dialog.value = true;
}

async function onSave() {
  if (form.id) {
    await http.put(`/departments/${form.id}`, { name: form.name, sort: form.sort });
    if (form.parentId !== undefined && form.parentId !== null && String(form.parentId) !== String(form.parent_id ?? '')) {
      await http.put(`/departments/${form.id}/parent`, { parent_id: form.parentId });
    }
  } else {
    await http.post('/departments', { parent_id: form.parentId || null, name: form.name, sort: form.sort });
  }
  ElMessage.success('已保存');
  dialog.value = false;
  await load();
}

async function onDelete(node: any) {
  await ElMessageBox.confirm(`确认删除部门「${node.name}」？存在子部门、在职员工或发布范围引用时将被拒绝。`, '删除确认', { type: 'warning' });
  try {
    await http.delete(`/departments/${node.id}`);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    // 部门停用承载引用场景（05 册 2.4.3）：删除被拒时可选择停用（PUT /departments/:id/status）
    const refRejected = String(e?.message || '').includes('引用') || String(e?.message || '').includes('员工') || String(e?.message || '').includes('子部门');
    if (!refRejected) return;
    const act = await ElMessageBox.confirm('该部门存在引用，是否改为「停用」？（停用保留为历史统计维度）', '改为停用', { type: 'warning' }).catch(() => null);
    if (act !== 'confirm') return;
    await http.put(`/departments/${node.id}/status`, { status: 0 });
    ElMessage.success('已停用');
    await load();
  }
}

async function onEnable(node: any) {
  await http.put(`/departments/${node.id}/status`, { status: 1 });
  ElMessage.success('已启用');
  await load();
}

onMounted(load);
</script>

<style scoped>
.node-row { display: flex; justify-content: space-between; align-items: center; width: 100%; padding-right: 12px; }
.node-actions { display: none; }
:deep(.el-tree-node__content:hover) .node-actions { display: inline; }
</style>
