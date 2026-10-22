<template>
  <div>
    <div class="toolbar" style="margin-bottom:14px">
      <el-button text @click="$router.push('/my/scores')"><el-icon><ArrowLeft /></el-icon>返回成绩列表</el-button>
    </div>

    <div v-if="record" class="score-hero" :class="record.status === 'passed' ? 'is-pass' : record.status === 'failed' ? 'is-fail' : 'is-timeout'">
      <div class="hero-score">
        <span class="hero-label">{{ record.status === 'passed' ? '已通过' : record.status === 'failed' ? '未通过' : '超时交卷' }}</span>
        <span class="hero-num re-mono">{{ record.score }}</span>
        <span class="hero-line re-mono">及格线 {{ record.pass_score }}</span>
      </div>
      <div class="hero-meta">
        <div class="meta-item"><span>作答次数</span><b>第 {{ record.attempt_no }} 次</b></div>
        <div class="meta-item"><span>历次最高</span><b class="re-mono">{{ record.best_score }}</b></div>
      </div>
    </div>

    <div v-for="q in record?.questions || []" :key="q.question_id" class="q-card">
      <div class="stem">
        <span class="q-text">{{ q.stem }}</span>
        <el-tag size="small" :type="q.is_correct === true ? 'success' : q.is_correct === false ? 'danger' : 'info'">
          {{ q.is_correct === true ? '答对' : q.is_correct === false ? '答错' : '未作答' }} · 得 {{ q.gained_score }}/{{ q.score }} 分
        </el-tag>
      </div>
      <div v-for="(o, i) in q.options || []" :key="i" class="option" :class="optionClass(q, i)">
        <span class="opt-key re-mono">{{ o.key }}</span>
        <span class="opt-text">{{ o.text }}</span>
        <el-tag v-if="(q.selected || []).includes(i)" size="small" class="opt-tag">我的选择</el-tag>
        <el-tag v-if="(q.answer || []).includes(i)" size="small" type="success" class="opt-tag">正确答案</el-tag>
      </div>
      <div v-if="q.analysis" class="analysis">解析：{{ q.analysis }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import http from '../../api/http';

const route = useRoute();
const record = ref<any>(null);

function optionClass(q: any, i: number) {
  const selected = (q.selected || []).includes(i);
  const correct = (q.answer || []).includes(i);
  if (correct) return 'opt-correct';
  if (selected) return 'opt-wrong';
  return '';
}

onMounted(async () => {
  record.value = await http.get(`/exams/records/${route.params.recordId}/result`);
});
</script>

<style scoped>
.score-hero {
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
  border-radius: var(--re-radius); padding: 22px 28px; margin-bottom: 16px;
  border: 1px solid var(--re-border); background: var(--re-surface); box-shadow: var(--re-shadow-card);
}
.score-hero.is-pass { background: linear-gradient(120deg, #eef7f2, #ffffff 55%); border-color: #cfe8dc; }
.score-hero.is-fail { background: linear-gradient(120deg, #fdefee, #ffffff 55%); border-color: #f3d3cf; }
.score-hero.is-timeout { background: linear-gradient(120deg, #fdf6ec, #ffffff 55%); border-color: #efd9b8; }
.hero-score { display: flex; flex-direction: column; }
.hero-label { font-size: 13px; font-weight: 600; letter-spacing: 2px; }
.is-pass .hero-label { color: #1d7a52; }
.is-fail .hero-label { color: #b42318; }
.is-timeout .hero-label { color: #b45309; }
.hero-num { font-size: 46px; font-weight: 700; line-height: 1.2; color: var(--re-text); }
.hero-line { font-size: 12px; color: var(--re-text-3); }
.hero-meta { display: flex; gap: 36px; }
.meta-item { display: flex; flex-direction: column; gap: 4px; }
.meta-item span { font-size: 12px; color: var(--re-text-3); }
.meta-item b { font-size: 15px; font-weight: 600; color: var(--re-text); }

.q-card {
  background: var(--re-surface); border: 1px solid var(--re-border); border-radius: var(--re-radius);
  padding: 18px 22px; margin-top: 12px; box-shadow: var(--re-shadow-card);
}
.stem { font-weight: 600; margin-bottom: 10px; display: flex; align-items: flex-start; gap: 10px; line-height: 1.6; }
.q-text { flex: 1; }
.option {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border-radius: var(--re-radius-sm); margin: 4px 0; border: 1px solid transparent;
}
.opt-key {
  flex: none; width: 22px; height: 22px; border-radius: 6px; font-size: 12px; font-weight: 700;
  background: #eef1f6; color: var(--re-text-2); display: inline-flex; align-items: center; justify-content: center;
}
.opt-text { flex: 1; font-size: 14px; color: var(--re-text); }
.opt-tag { flex: none; }
.opt-correct { background: #eefaf3; border-color: #cdeadd; }
.opt-correct .opt-key { background: #2e9e6b; color: #fff; }
.opt-wrong { background: #fdf1f0; border-color: #f5d4d0; }
.opt-wrong .opt-key { background: #d92d20; color: #fff; }
.analysis {
  margin-top: 10px; color: #1d7a52; font-size: 13px; background: #f2faf6;
  padding: 10px 14px; border-radius: var(--re-radius-sm); line-height: 1.8;
}
</style>
