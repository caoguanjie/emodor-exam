import type { RouteScenario } from '../types'

export const identityRouteCatalog: RouteScenario[] = [
  { path: '/pages/identity/index', scenario: 'identity-collect', pencilBoard: 'mRBVM', expectedText: '请确认照片为本人证件及本人正脸。' },
  { path: '/pages/identity/index', scenario: 'identity-source', pencilBoard: 'MEvwS', expectedText: '上传身份证人像面' },
  { path: '/pages/identity/index', scenario: 'identity-face-guide', pencilBoard: 'OMfFk', expectedText: '拍摄本人正脸' },
  { path: '/pages/identity/index', scenario: 'identity-uploading', pencilBoard: 'rWuDB', expectedText: '正在上传并识别国徽面，请稍候。' },
  { path: '/pages/identity/index', scenario: 'identity-ready', pencilBoard: 'FuNk8', expectedText: '三张照片已就绪，请确认后提交。' },
  { path: '/pages/identity/index', scenario: 'identity-verifying', pencilBoard: 'z3zF4', expectedText: '正在核验身份' },
  { path: '/pages/identity/index', scenario: 'identity-pending', pencilBoard: 'WfDJI', expectedText: '认证结果处理中' },
  { path: '/pages/identity/index', scenario: 'identity-success', pencilBoard: 'ePapq', expectedText: '实名认证成功' },
  { path: '/pages/identity/detail', scenario: 'identity-detail', pencilBoard: 'P0rCMp', expectedText: '已通过实名认证' },
  { path: '/pages/identity/index', scenario: 'identity-face-rejected', pencilBoard: 'nJHTm', expectedText: '人像核验未通过，证件照片已保留。' },
  { path: '/pages/identity/index', scenario: 'identity-emblem-rejected', pencilBoard: 'M3UfG', expectedText: '国徽面无法识别，请上传清晰、完整的原件照片。' },
  { path: '/pages/identity/index', scenario: 'identity-upload-failed', pencilBoard: 'D8wgXK', expectedText: '照片上传失败，请检查网络后重试。其他材料已保留。' },
  { path: '/pages/identity/index', scenario: 'identity-load-failed', pencilBoard: 'OLXgA', expectedText: '暂时无法获取实名状态' },
  { path: '/pages/identity/index', scenario: 'identity-service-error', pencilBoard: 'uD0Us', expectedText: '核验服务暂不可用' },
  { path: '/pages/identity/index', scenario: 'identity-bound', pencilBoard: 'oD7Ix', expectedText: '该身份已绑定其他账号' },
  { path: '/pages/identity/index', scenario: 'identity-expired', pencilBoard: 'XYPSP', expectedText: '本次认证会话已过期' },
  // 补充交互状态无独立正式画板，以下 pencilBoard 仅表示复用的视觉布局。
  { path: '/pages/identity/index', scenario: 'identity-camera-denied', pencilBoard: 'mRBVM', expectedText: '无法使用相机，请检查浏览器相机权限后重试。' },
  { path: '/pages/identity/index', scenario: 'identity-unsafe', pencilBoard: 'M3UfG', expectedText: '照片未通过安全检查，请重新上传清晰的证件原件照片。' },
]
