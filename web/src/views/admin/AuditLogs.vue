<template>
  <section class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch>
          <el-form-item label="日期">
            <el-date-picker
              v-model="dates"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
            />
          </el-form-item>
          <el-form-item label="操作人">
            <el-input v-model="query.actor" clearable placeholder="账号或姓名" @keyup.enter="search" />
          </el-form-item>
          <el-form-item label="记录范围">
            <el-select v-model="query.scope" aria-label="记录范围">
              <el-option label="管理操作" value="management" />
              <el-option label="登录与安全" value="security" />
              <el-option label="考试事件" value="exam" />
              <el-option label="学员行为" value="learner" />
              <el-option label="系统事件" value="system" />
              <el-option label="全部记录" value="all" />
            </el-select>
          </el-form-item>
          <el-form-item label="结果">
            <el-select v-model="query.result" aria-label="结果">
              <el-option label="全部" value="" />
              <el-option label="成功" value="success" />
              <el-option label="失败" value="failure" />
            </el-select>
          </el-form-item>
          <template #actions>
            <el-button type="primary" @click="search">查询</el-button>
            <el-button @click="reset">重置</el-button>
          </template>
        </FitsListSearch>
      </template>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false">
        <el-button link @click="load">重试</el-button>
      </el-alert>

      <el-table v-loading="loading" :data="items" empty-text="暂无操作记录">
        <el-table-column label="时间" min-width="175">
          <template #default="{ row }">{{ formatTime(row.ts) }}</template>
        </el-table-column>
        <el-table-column label="操作人" min-width="140">
          <template #default="{ row }">{{ auditActorLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="模块" min-width="120">
          <template #default="{ row }"><el-tag type="info" effect="plain">{{ auditPresentation(row).module }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作内容" min-width="180">
          <template #default="{ row }">{{ auditPresentation(row).action }}</template>
        </el-table-column>
        <el-table-column label="对象" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ auditPresentation(row).target }}</template>
        </el-table-column>
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="row.result === 'success' ? 'success' : 'danger'">{{ row.result === 'success' ? '成功' : '失败' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <FitsTableActions style="justify-content: center">
              <FitsTableAction type="primary" @click="openDetail(row)">查看</FitsTableAction>
            </FitsTableActions>
          </template>
        </el-table-column>
      </el-table>

      <template #pagination>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.page_size"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @change="load"
        />
      </template>
    </FitsTable>

    <el-dialog
      v-model="detailVisible"
      title="记录详情"
      width="min(760px, calc(100vw - 32px))"
      align-center
      :append-to="contentDialogTarget || 'body'"
      class="re-form-dialog audit-detail-dialog"
      destroy-on-close
      @closed="selectedRow = null"
    >
      <template v-if="selectedRow">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="操作时间">{{ formatTime(selectedRow.ts) }}</el-descriptions-item>
          <el-descriptions-item label="操作人">{{ auditActorLabel(selectedRow) }}</el-descriptions-item>
          <el-descriptions-item label="业务模块">{{ auditPresentation(selectedRow).module }}</el-descriptions-item>
          <el-descriptions-item label="操作内容">{{ auditPresentation(selectedRow).action }}</el-descriptions-item>
          <el-descriptions-item label="业务对象">{{ auditPresentation(selectedRow).target }}</el-descriptions-item>
          <el-descriptions-item label="操作结果">
            <el-tag :type="selectedRow.result === 'success' ? 'success' : 'danger'">{{ selectedRow.result === 'success' ? '成功' : '失败' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="来源 IP">{{ selectedRow.source_ip || '未记录' }}</el-descriptions-item>
        </el-descriptions>

        <section class="detail-section">
          <h3>变更内容</h3>
          <el-empty v-if="!detailEntries.length" :image-size="60" description="本次记录没有补充信息" />
          <div v-else class="change-list">
            <div v-for="entry in detailEntries" :key="entry.key" class="change-row">
              <span class="change-label">{{ entry.label }}</span>
              <template v-if="entry.before !== undefined || entry.after !== undefined">
                <span class="change-before">{{ entry.before }}</span>
                <span class="change-arrow">›</span>
                <span class="change-after">{{ entry.after }}</span>
              </template>
              <span v-else class="change-value">{{ entry.value }}</span>
            </div>
          </div>
        </section>

        <details class="technical-details">
          <summary>技术信息</summary>
          <dl>
            <dt>原始操作人</dt><dd>{{ selectedRow.actor_name || '—' }}（ID：{{ selectedRow.actor_id ?? '—' }}）</dd>
            <dt>操作代码</dt><dd>{{ selectedRow.action }}</dd>
            <dt>对象标识</dt><dd>{{ selectedRow.object_type }} #{{ selectedRow.object_id ?? '—' }}</dd>
          </dl>
          <pre>{{ formatAuditJson(selectedRow.detail) }}</pre>
        </details>
      </template>
      <template #footer><el-button @click="detailVisible = false">关闭</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, reactive, ref, type Ref } from 'vue';
import http from '../../api/http';
import { FitsListSearch, FitsTable, FitsTableAction, FitsTableActions } from '../../components/FitsTable';
import {
  auditActorLabel,
  auditDetailEntries,
  auditPresentation,
  formatAuditJson,
  type AuditLogRow,
} from '../../utils/audit-log-display';

type AuditScope = 'management' | 'security' | 'exam' | 'learner' | 'system' | 'all';
type ResultFilter = '' | 'success' | 'failure';

const items = ref<AuditLogRow[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');
const dates = ref<string[]>([]);
const contentDialogTarget = inject<Ref<HTMLElement | undefined>>('contentDialogTarget', ref());
const query = reactive({ actor: '', scope: 'management' as AuditScope, result: '' as ResultFilter, page: 1, page_size: 20 });
const detailVisible = ref(false);
const selectedRow = ref<AuditLogRow | null>(null);
const detailEntries = computed(() => selectedRow.value ? auditDetailEntries(selectedRow.value.detail) : []);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await http.get('/admin/audit-logs', {
      params: {
        date_from: dates.value?.[0],
        date_to: dates.value?.[1],
        actor: query.actor.trim() || undefined,
        scope: query.scope,
        result: query.result || undefined,
        page: query.page,
        page_size: query.page_size,
      },
    }) as { items: AuditLogRow[]; total: number };
    items.value = data.items;
    total.value = data.total;
  } catch (caught: any) {
    error.value = caught?.message || '操作记录加载失败';
  } finally {
    loading.value = false;
  }
}

async function search() {
  query.page = 1;
  await load();
}

async function reset() {
  dates.value = [];
  Object.assign(query, { actor: '', scope: 'management', result: '', page: 1, page_size: 20 });
  await load();
}

function openDetail(row: AuditLogRow) {
  selectedRow.value = row;
  detailVisible.value = true;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

void load();
</script>

<style scoped>
.page-card { min-height: 420px; padding: 20px; border: 1px solid var(--re-border); border-radius: 12px; background: #fff; }
.detail-section { margin-top: 24px; }
.detail-section h3 { margin: 0 0 12px; color: var(--re-text-1); font-size: 15px; }
.change-list { overflow: hidden; border: 1px solid var(--re-border); border-radius: 8px; }
.change-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) 24px minmax(0, 1fr); align-items: start; min-height: 44px; padding: 11px 12px; border-bottom: 1px solid var(--re-border); line-height: 22px; }
.change-row:last-child { border-bottom: 0; }
.change-label { color: var(--re-text-2); }
.change-before { color: var(--re-text-3); word-break: break-word; }
.change-arrow { color: var(--el-color-primary); text-align: center; }
.change-after, .change-value { color: var(--re-text-1); word-break: break-word; }
.change-value { grid-column: 2 / 5; }
.technical-details { margin-top: 20px; color: var(--re-text-2); }
.technical-details summary { cursor: pointer; user-select: none; }
.technical-details dl { display: grid; grid-template-columns: 88px 1fr; gap: 8px 12px; margin: 14px 0; }
.technical-details dt { color: var(--re-text-3); }
.technical-details dd { margin: 0; word-break: break-all; }
.technical-details pre { overflow: auto; max-height: 260px; margin: 0; padding: 12px; border-radius: 8px; background: var(--re-bg); color: var(--re-text-2); font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
</style>
