<template>
  <div class="login-wrap">
    <div class="pwd-card page-enter">
      <div class="pwd-head">
        <img class="pwd-logo" :src="brandLogo" alt="EmodorRuleExam Logo" />
        <div>
          <div class="pwd-brand-name">EmodorRuleExam</div>
          <h3>首次登录，请修改密码</h3>
          <p>初始密码须 ≥ 8 位、同时包含字母与数字，且不得包含用户名 / 工号 / 姓名的连续 3 位字符。</p>
        </div>
      </div>
      <el-form label-width="90px">
        <el-form-item label="原密码"><el-input v-model="oldPwd" type="password" show-password placeholder="请输入初始密码" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="newPwd" type="password" show-password placeholder="≥8 位，字母 + 数字" /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="newPwd2" type="password" show-password placeholder="再次输入新密码" /></el-form-item>
        <el-button type="primary" class="pwd-btn" :loading="loading" :disabled="!oldPwd || !newPwd || newPwd !== newPwd2" @click="onChange">
          {{ newPwd && newPwd !== newPwd2 ? '两次输入不一致' : '修改密码并进入系统' }}
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { postAuthPath } from '../router/access';
import brandLogo from '../assets/brand-logo.png';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const oldPwd = ref('');
const newPwd = ref('');
const newPwd2 = ref('');
const loading = ref(false);

async function onChange() {
  loading.value = true;
  try {
    await auth.changePassword(oldPwd.value, newPwd.value);
    router.push(postAuthPath(auth.isAdmin, route.query.redirect));
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap { min-height: 100%; display: flex; align-items: center; justify-content: center; }
.pwd-card {
  width: 460px; background: var(--re-surface); border: 1px solid var(--re-border);
  border-radius: 16px; padding: 32px 34px; box-shadow: var(--re-shadow-pop);
}
.pwd-head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 22px; }
.pwd-logo { width: 40px; height: 40px; border-radius: 10px; object-fit: cover; flex: none; }
.pwd-brand-name { margin-bottom: 4px; color: var(--re-text-3); font-size: 12px; font-weight: 600; }
.pwd-head h3 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
.pwd-head p { margin: 0; font-size: 12.5px; color: var(--re-text-3); line-height: 1.7; }
.pwd-btn { width: 100%; letter-spacing: 2px; }
</style>
