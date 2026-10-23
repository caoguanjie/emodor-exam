<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppTopBar from '@/components/common/AppTopBar.vue'
import IdentityStatus from '@/components/identity/IdentityStatus.vue'
import { identityVerifiedInfo, resolveIdentityScenario } from '@/fixtures/ui-scenarios/identity'
import { isStaticSessionPreview } from '@/platform/session'
import { useIdentityStore } from '@/stores/identity'

const preview = ref(false)
const scenario = ref(resolveIdentityScenario(undefined, 'identity-detail'))
const store = useIdentityStore()
const info = computed(() => preview.value ? identityVerifiedInfo : { name: store.authority?.real_name || '', maskedId: store.authority?.id_number_masked || '' })
onLoad(query => { preview.value = isStaticSessionPreview(query); scenario.value = resolveIdentityScenario(query?.scenario, 'identity-detail'); if (!preview.value) void store.load() })
onUnload(() => { if (!preview.value) store.leave() })
function profile() { uni.reLaunch({ url: `/pages/profile/index${preview.value ? '?scenario=profile-default' : ''}` }) }
</script>

<template><AppPage :padded="false"><template #header><AppTopBar title="实名详情" :back-target="`/pages/profile/index${preview ? '?scenario=profile-default' : ''}`" :history-first="false" /></template><IdentityStatus v-if="preview ? scenario.state === 'verified' : store.verified" mode="detail" :info="info" @profile="profile" /><IdentityStatus v-else-if="store.loadError" mode="load-error" :info="info" @retry="store.load" @profile="profile" /><view v-else style="padding:24px">{{ store.loading ? '正在读取实名信息…' : '当前尚未完成实名认证' }}</view></AppPage></template>
