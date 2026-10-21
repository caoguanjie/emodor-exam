<template>
  <div>
    <div class="page-head">
      <div class="eyebrow">我的学习</div>
      <h2>我的制度</h2>
      <p class="desc">完成有效学习（时长达标 + 覆盖底部段）即可获得对应考试资格</p>
    </div>

    <div v-loading="loading" class="reg-grid">
      <div v-for="row in list" :key="row.id" class="reg-card">
        <div class="reg-top">
          <span class="reg-icon"><el-icon><Reading /></el-icon></span>
          <el-tag v-if="row.category" size="small" type="info" effect="light">{{ row.category }}</el-tag>
        </div>
        <h3 class="reg-title">{{ row.title }}</h3>
        <p class="reg-req">时长 ≥ {{ row.required_minutes }} 分钟 · {{ row.scroll_segments }} 段覆盖</p>

        <div class="reg-progress">
          <template v-if="row.learning">
            <div class="rp-head">
              <span>学习时长</span>
              <span class="re-mono">{{ fmt(row.learning.total_seconds) }} / {{ Math.round(row.learning.required_seconds / 60) }} 分钟</span>
            </div>
            <el-progress :percentage="timePercent(row.learning)" :show-text="false"
              :stroke-width="8" :color="row.learning.is_valid ? '#2e9e6b' : '#3056d3'" />
            <div class="rp-status">
              <el-tag v-if="row.learning.is_valid" type="success" size="small">有效学习已达标</el-tag>
              <el-tag v-else type="info" size="small">未达标</el-tag>
            </div>
          </template>
          <template v-else>
            <div class="rp-head"><span>学习时长</span><span class="re-mono">0%</span></div>
            <el-progress :percentage="0" :show-text="false" :stroke-width="8" />
            <div class="rp-status"><el-tag type="info" size="small">未开始</el-tag></div>
          </template>
        </div>

        <div class="reg-foot">
          <el-button type="primary" @click="$router.push(`/my/regulations/${row.id}/read`)">
            {{ row.learning?.is_valid ? '继续阅读' : '开始学习' }}
          </el-button>
        </div>
      </div>
    </div>
    <el-empty v-if="!loading && !list.length" description="暂无待学习的制度，发布后将出现在这里" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Reading } from '@element-plus/icons-vue';
import http from '../../api/http';

const list = ref<any[]>([]);
const loading = ref(false);

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m} 分 ${sec % 60} 秒` : `${sec} 秒`;
}
function timePercent(row: any) {
  return Math.min(100, Math.round((row.total_seconds / row.required_seconds) * 100));
}

onMounted(async () => {
  loading.value = true;
  try {
    const d: any = await http.get('/learning/regulations');
    list.value = d.list;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.reg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.reg-card {
  background: var(--re-surface); border: 1px solid var(--re-border); border-radius: var(--re-radius);
  padding: 20px; box-shadow: var(--re-shadow-card); display: flex; flex-direction: column;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.reg-card:hover { box-shadow: var(--re-shadow-pop); transform: translateY(-2px); }
.reg-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.reg-icon {
  width: 40px; height: 40px; border-radius: 11px; font-size: 19px;
  background: var(--el-color-primary-light-9); color: var(--re-primary);
  display: flex; align-items: center; justify-content: center;
}
.reg-title { font-size: 16px; font-weight: 600; margin: 0 0 6px; line-height: 1.5; }
.reg-req { font-size: 12.5px; color: var(--re-text-3); margin: 0 0 16px; }
.reg-progress { margin-top: auto; }
.rp-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--re-text-2); margin-bottom: 6px; }
.rp-head .re-mono { color: var(--re-text); font-size: 12px; }
.rp-status { margin-top: 8px; }
.reg-foot { margin-top: 16px; display: flex; }
.reg-foot .el-button { flex: 1; }
</style>
