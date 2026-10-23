<template>
  <div class="import-preview">
    <div class="preview-summary">
      <el-tag type="success">可导入 {{ preview.valid_rows.length }} 行</el-tag>
      <el-tag v-if="preview.errors.length" type="danger">失败 {{ preview.errors.length }} 行</el-tag>
      <el-tag v-if="preview.duplicates.length" type="warning">重复 {{ preview.duplicates.length }} 行</el-tag>
    </div>
    <el-alert v-if="!preview.valid_rows.length" type="warning" :closable="false" title="没有可确认的行，请修正失败行后重新上传" />
    <el-table v-if="preview.errors.length" :data="preview.errors" size="small" max-height="240">
      <el-table-column prop="row" label="行号" width="80" />
      <el-table-column prop="message" label="原因" min-width="220" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import type { ImportPreview as Preview } from '../api/training-types';

defineProps<{ preview: Preview }>();
</script>

<style scoped>
.preview-summary { display: flex; gap: 8px; margin-bottom: 12px; }
</style>
