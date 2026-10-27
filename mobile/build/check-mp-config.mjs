import { inspectMpPublicConfig } from './mp-public-config.mjs'

// Deliberately do not load .env files or inspect private server configuration.
const report = inspectMpPublicConfig(process.env)
if (!report.ready) {
  for (const error of report.errors) console.error(error)
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ request: report.requestDomains, uploadFile: report.uploadDomains, downloadFile: report.downloadDomains }, null, 2))
  console.log('公开配置检查通过。导入开发者工具后仍需选择自己的测试号或正式 AppID，并核对微信后台合法域名与隐私保护指引。')
}
