<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from './platform/session'
import { useSessionStore } from './stores/session'
import { resumeLearnerNavigation } from './platform/navigation'
import { examEntryIntentFromRoute, saveExamEntryIntent } from './utils/exam-entry-intent'

onLaunch(async options => {
  if (isStaticSessionPreview(options?.query)) return
  if (options?.path === 'pages/profile/about' || options?.path === 'pages/profile/terms') return
  const intent = examEntryIntentFromRoute(options?.path, options?.query)
  if (intent?.kind === 'exam-tab') saveExamEntryIntent(intent)
  const session = useSessionStore()
  const startedEpoch = session.sessionEpoch
  const restored = await session.bootstrap()
  if (restored && startedEpoch === session.sessionEpoch && session.user && (!options?.path || options.path === 'pages/auth/login')) resumeLearnerNavigation(session.user)
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
