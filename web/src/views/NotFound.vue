<template>
  <div class="not-found">
    <div class="code">404</div>
    <h1>页面未找到</h1>
    <p>地址可能已变更，或当前账号没有对应入口。</p>
    <el-button type="primary" @click="router.push('/')">返回首页</el-button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<style scoped>
.not-found { min-height: 55vh; display: grid; place-content: center; justify-items: center; color: var(--re-text-2); text-align: center; }
.code { font-size: 88px; line-height: 1; font-weight: 800; color: var(--re-primary); opacity: .85; }
h1 { margin: 18px 0 4px; color: var(--re-text); }
p { margin: 0 0 24px; }
</style>
