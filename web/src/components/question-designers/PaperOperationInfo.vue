<template>
  <section class="paper-operation-info" aria-label="操作信息">
    <h3 class="designer-property-group-title">操作信息</h3>
    <dl class="paper-operation-info__rows">
      <dt>创建人</dt><dd>{{ paper.created_by_name || '—' }}</dd>
      <dt>创建时间</dt><dd>{{ paper.created_at ? formatDateTime(paper.created_at) : '尚未保存' }}</dd>
      <dt>更新人</dt><dd>{{ paper.updated_by_name || '—' }}</dd>
      <dt>更新时间</dt><dd>{{ paper.updated_at ? formatDateTime(paper.updated_at) : '尚未保存' }}</dd>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { DesignerPaper } from './contracts';
import { formatDateTime } from '../../utils/format';
defineProps<{ paper: DesignerPaper }>();
</script>

<style scoped>
.paper-operation-info__rows { display:grid; grid-template-columns:76px minmax(0,1fr); gap:16px 0; margin:0; padding:16px; font-size:14px; line-height:22px; }
.paper-operation-info__rows dt { color:#7a8794; }
.paper-operation-info__rows dd { margin:0; color:var(--el-text-color-regular); overflow-wrap:anywhere; }
</style>
