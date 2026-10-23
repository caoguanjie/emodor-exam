<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from './platform/session'
import { useSessionStore } from './stores/session'

onLaunch(async options => {
  if (isStaticSessionPreview(options?.query)) return
  const session = useSessionStore()
  const startedEpoch = session.sessionEpoch
  const restored = await session.bootstrap()
  if (restored && startedEpoch === session.sessionEpoch && (!options?.path || options.path === 'pages/auth/login')) uni.reLaunch({ url: '/pages/home/index' })
})
</script>

<style lang="scss">
@use './styles/tokens.scss';

page {
  min-height: 100%;
  background: var(--app-color-background);
  color: var(--app-color-text);
  font-family: var(--app-font-family);
  font-size: 28rpx;
  line-height: 1.5;
}

view,
text {
  box-sizing: border-box;
}
</style>
