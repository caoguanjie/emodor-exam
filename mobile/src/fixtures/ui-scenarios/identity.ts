import type { IdentityMaterials, IdentityVerifiedInfo, IdentityViewState } from '@/types/identity'

export interface IdentityScenario {
  id: string
  group: 'identity' | 'identity-detail'
  state: IdentityViewState
  materials: IdentityMaterials
  title: string
  description: string
  feedback: string
  feedbackTone: 'muted' | 'secondary' | 'primary' | 'danger'
  overlay?: 'source' | 'face-guide' | 'verifying' | 'service-error' | 'bound'
  issue?: 'face' | 'emblem' | 'upload' | 'load' | 'expired' | 'camera' | 'unsafe'
}

const empty: IdentityMaterials = { portrait: null, emblem: null, face: null, consent: false }
const ready: IdentityMaterials = { portrait: 'ready', emblem: 'ready', face: 'ready', consent: true }
const intro = { title: '认证本人身份', description: '准备本人身份证，拍摄本人正脸。\n姓名和证件号将自动识别。' }
const collection: IdentityScenario = { id: 'identity-collect', group: 'identity', state: 'unverified', materials: empty, ...intro, feedback: '请确认照片为本人证件及本人正脸。', feedbackTone: 'muted' }

export const identityScenarios: Record<string, IdentityScenario> = {
  'identity-collect': collection,
  'identity-source': { ...collection, id: 'identity-source', overlay: 'source' },
  'identity-face-guide': { ...collection, id: 'identity-face-guide', overlay: 'face-guide' },
  'identity-uploading': { ...collection, id: 'identity-uploading', state: 'collecting', materials: { ...empty, portrait: 'ready', emblem: 'uploading' }, feedback: '正在上传并识别国徽面，请稍候。', feedbackTone: 'primary' },
  'identity-ready': { ...collection, id: 'identity-ready', state: 'collecting', materials: ready, feedback: '三张照片已就绪，请确认后提交。', feedbackTone: 'secondary' },
  'identity-verifying': { ...collection, id: 'identity-verifying', state: 'submitting', materials: ready, overlay: 'verifying', feedback: '正在核验本人身份，请勿重复提交。', feedbackTone: 'primary' },
  'identity-pending': { ...collection, id: 'identity-pending', state: 'pending', materials: ready, title: '认证结果处理中', description: '本次申请已提交，正在等待核验结果。\n无需再次上传或重复提交。', feedback: '尚未获得最终结果，不代表认证失败。', feedbackTone: 'primary' },
  'identity-success': { ...collection, id: 'identity-success', state: 'verified', materials: ready },
  'identity-detail': { ...collection, id: 'identity-detail', group: 'identity-detail', state: 'verified', materials: ready },
  'identity-face-rejected': { ...collection, id: 'identity-face-rejected', state: 'rejected', materials: { ...ready, face: 'error' }, issue: 'face', feedback: '人像核验未通过，证件照片已保留。', feedbackTone: 'danger' },
  'identity-emblem-rejected': { ...collection, id: 'identity-emblem-rejected', state: 'rejected', materials: { ...ready, emblem: 'error' }, issue: 'emblem', feedback: '国徽面无法识别，请上传清晰、完整的原件照片。', feedbackTone: 'danger' },
  'identity-upload-failed': { ...collection, id: 'identity-upload-failed', state: 'error', materials: { ...ready, emblem: 'error' }, issue: 'upload', feedback: '照片上传失败，请检查网络后重试。其他材料已保留。', feedbackTone: 'danger' },
  'identity-load-failed': { ...collection, id: 'identity-load-failed', state: 'error', issue: 'load' },
  'identity-service-error': { ...collection, id: 'identity-service-error', state: 'error', materials: ready, overlay: 'service-error', feedback: '三张照片已就绪，请确认后提交。', feedbackTone: 'secondary' },
  'identity-bound': { ...collection, id: 'identity-bound', state: 'rejected', materials: ready, overlay: 'bound', feedback: '三张照片已就绪，请确认后提交。', feedbackTone: 'secondary' },
  'identity-expired': { ...collection, id: 'identity-expired', state: 'error', materials: ready, issue: 'expired', title: '本次认证会话已过期', description: '未获得有效认证结果，可重新提交核验。\n材料仍有效时，无需重复拍摄。', feedback: '重新提交将发起新的身份核验。', feedbackTone: 'secondary' },
  // 以下为补充交互状态，无独立正式画板，复用采集页和识别失败页视觉。
  'identity-camera-denied': { ...collection, id: 'identity-camera-denied', state: 'error', issue: 'camera', feedback: '无法使用相机，请检查浏览器相机权限后重试。', feedbackTone: 'danger' },
  'identity-unsafe': { ...collection, id: 'identity-unsafe', state: 'rejected', materials: { ...ready, emblem: 'unsafe' }, issue: 'unsafe', feedback: '照片未通过安全检查，请重新上传清晰的证件原件照片。', feedbackTone: 'danger' },
}

export function resolveIdentityScenario(query: unknown, fallback = 'identity-collect'): IdentityScenario {
  const defaultScenario = identityScenarios[fallback] || identityScenarios['identity-collect']
  const selected = typeof query === 'string' ? identityScenarios[query] : undefined
  const resolved = selected?.group === defaultScenario.group ? selected : defaultScenario
  return { ...resolved, materials: { ...resolved.materials } }
}

// 只用于还原设计稿的合成演示资料；不含证件原图或正脸材料。
export const identityVerifiedInfo: IdentityVerifiedInfo = {
  name: '张三', maskedId: '4401**********1234', gender: '男', birthday: '1990-05-20',
  nationality: '汉', authority: '广州市公安局海珠区分局', validity: '2020-05-20 至 2040-05-20',
}
