<template>
  <div class="login-wrap">
    <!-- 左侧品牌叙事：公文藏蓝 + 品牌 Logo -->
    <aside class="brand-pane">
      <div class="brand-top">
        <img class="brand-logo" :src="brandLogo" alt="海珠区安全教育培训中心 Logo" />
        <span class="brand-name">海珠区安全教育培训中心</span>
      </div>
      <h1 class="brand-title re-display">让每一次安全培训<br />都真正落到实处</h1>
      <p class="brand-sub">安全培训 · 在线学习 · AI 出题 · 考试评分 · 统计跟进</p>
      <ul class="brand-points">
        <li>
          <span class="pt-icon"><el-icon><Reading /></el-icon></span>
          <div><strong>学习留痕</strong><em>时长与滚动覆盖全部服务端结算</em></div>
        </li>
        <li>
          <span class="pt-icon"><el-icon><EditPen /></el-icon></span>
          <div><strong>AI 出题</strong><em>依据制度原文自动生成题库</em></div>
        </li>
        <li>
          <span class="pt-icon"><el-icon><Lock /></el-icon></span>
          <div><strong>风控考试</strong><em>权威计时 · 切屏监测 · 成绩不可改</em></div>
        </li>
      </ul>
      <p class="brand-foot">海珠区安全教育培训中心</p>
    </aside>

    <!-- 右侧登录表单 -->
    <main class="form-pane">
      <div class="form-card page-enter">
        <div class="form-brand-sm">
          <img class="brand-logo-sm" :src="brandLogo" alt="海珠区安全教育培训中心 Logo" />
          <span>海珠区安全教育培训中心</span>
        </div>
        <h2>登录</h2>
        <p class="form-hint">使用企业统一分配的账号进入系统</p>
        <el-form @submit.prevent="onLogin">
          <el-form-item>
            <el-input v-model="username" placeholder="用户名" size="large" autofocus>
              <template #prefix><el-icon><User /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-input v-model="password" type="password" placeholder="密码" size="large" show-password>
              <template #prefix><el-icon><Lock /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <div class="captcha-row">
              <el-input v-model="captchaCode" placeholder="验证码（管理员必填）" size="large" maxlength="8" @keyup.enter="onLogin">
                <template #prefix><el-icon><Key /></el-icon></template>
              </el-input>
              <button class="captcha-image" type="button" title="刷新验证码" @click="loadCaptcha">
                <img v-if="captchaImage" :src="captchaImage" alt="验证码" />
                <span v-else>加载中</span>
              </button>
            </div>
          </el-form-item>
          <el-button type="primary" size="large" class="submit-btn" :loading="loading" native-type="submit">登 录</el-button>
        </el-form>
        <p class="form-foot">首次登录将要求修改初始密码</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { User, Lock, Key, Reading, EditPen } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import http from '../api/http';
import { defaultHomePath, validPostAuthRedirect } from '../router/access';
import brandLogo from '../assets/brand-logo.png';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const username = ref('');
const password = ref('');
const captchaId = ref('');
const captchaImage = ref('');
const captchaCode = ref('');
const loading = ref(false);

async function loadCaptcha() {
  const issued: any = await http.post(
    '/auth/captcha',
    captchaId.value ? { previous_captcha_id: captchaId.value } : undefined,
  );
  captchaId.value = issued.captcha_id;
  captchaImage.value = issued.image;
  captchaCode.value = '';
}

async function onLogin() {
  if (!username.value || !password.value) return;
  loading.value = true;
  try {
    await auth.login(username.value, password.value, captchaId.value || undefined, captchaCode.value || undefined);
    const redirect = validPostAuthRedirect(route.query.redirect);
    router.push(auth.needChangePassword
      ? { path: '/change-password', query: redirect ? { redirect } : {} }
      : redirect || defaultHomePath(auth.isAdmin));
  } finally {
    loading.value = false;
  }
}

onMounted(() => { loadCaptcha().catch(() => undefined); });
</script>

<style scoped>
.login-wrap { min-height: 100%; display: flex; }

/* ---- 左侧品牌面板 ---- */
.brand-pane {
  flex: 1.1; min-width: 0; display: flex; flex-direction: column; justify-content: center;
  padding: 64px 72px; color: #fff; position: relative; overflow: hidden;
  background:
    radial-gradient(900px 480px at 110% -10%, rgba(48, 86, 211, 0.35), transparent 65%),
    radial-gradient(700px 420px at -20% 110%, rgba(194, 64, 42, 0.22), transparent 60%),
    linear-gradient(160deg, var(--re-ink) 0%, #0e1730 100%);
}
.brand-top { display: flex; align-items: center; gap: 12px; margin-bottom: 56px; }
.brand-logo { width: 48px; height: 48px; border-radius: 12px; object-fit: cover; flex: none; }
.brand-logo-sm { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; flex: none; }
.brand-name { font-size: 20px; font-weight: 700; letter-spacing: 0; white-space: nowrap; }
.brand-title { font-size: 40px; line-height: 1.35; font-weight: 700; margin: 0 0 18px; letter-spacing: 1px; }
.brand-sub { font-size: 14px; color: rgba(255, 255, 255, 0.62); margin: 0 0 48px; letter-spacing: 1px; }
.brand-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; max-width: 420px; }
.brand-points li { display: flex; gap: 14px; align-items: flex-start; }
.pt-icon {
  flex: none; width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14); font-size: 18px;
}
.brand-points strong { display: block; font-size: 15px; font-weight: 600; margin-bottom: 2px; }
.brand-points em { font-style: normal; font-size: 12.5px; color: rgba(255, 255, 255, 0.55); }
.brand-foot { margin-top: 64px; font-size: 12px; color: rgba(255, 255, 255, 0.35); letter-spacing: 2px; }

/* ---- 右侧表单面板 ---- */
.form-pane {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 48px 40px; background: var(--re-bg);
}
.form-card {
  width: 380px; background: var(--re-surface); border: 1px solid var(--re-border);
  border-radius: 16px; padding: 40px 36px 28px; box-shadow: var(--re-shadow-pop);
}
.form-brand-sm { display: none; align-items: center; gap: 8px; font-weight: 700; font-size: 17px; margin-bottom: 24px; }
.form-card h2 { font-size: 24px; margin: 0 0 8px; font-weight: 600; }
.form-hint { font-size: 13px; color: var(--re-text-3); margin: 0 0 26px; }
.submit-btn { width: 100%; margin-top: 4px; letter-spacing: 6px; }
.captcha-row { width: 100%; display: flex; gap: 10px; }
.captcha-row .el-input { flex: 1; min-width: 0; }
.captcha-image { width: 128px; height: 40px; flex: none; border: 1px solid var(--re-border); border-radius: 6px; padding: 0; background: #f2f5fb; cursor: pointer; overflow: hidden; }
.captcha-image img { width: 100%; height: 100%; display: block; }
.captcha-image span { color: var(--re-text-3); font-size: 12px; }
.form-foot { text-align: center; font-size: 12px; color: var(--re-text-3); margin: 18px 0 0; }

@media (max-width: 900px) {
  .brand-pane { display: none; }
  .form-brand-sm { display: flex; }
}
</style>
