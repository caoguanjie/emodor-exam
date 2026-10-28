import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const originPattern = /^https:\/\/[a-z0-9][a-z0-9-]*-\d+\.cos\.[a-z][a-z0-9-]+\.myqcloud\.com$/;
const directoryPattern = /^(?:[A-Za-z0-9_-]+\/)+$/;

/** Public locations only. No credential is selected, serialized or logged. */
export function resolvePublicMediaConfig(environment = {}) {
  const bucket = environment.COS_BUCKET || '', region = environment.COS_REGION || '';
  if (bucket && (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(bucket) || bucket.length > 63)) throw new Error('COS_BUCKET 格式无效');
  if (region && !/^[a-z][a-z0-9-]+$/.test(region)) throw new Error('COS_REGION 格式无效');
  if (!!bucket !== !!region) throw new Error('COS_BUCKET 与 COS_REGION 必须同时配置');
  const expectedOrigin = bucket ? `https://${bucket}.cos.${region}.myqcloud.com` : '';
  const origin = environment.VITE_COS_MEDIA_ORIGIN || expectedOrigin;
  if (origin && !originPattern.test(origin)) throw new Error('VITE_COS_MEDIA_ORIGIN 必须是精确的标准 HTTPS COS 桶 origin，不含路径、端口或通配符');
  if (origin && expectedOrigin && origin !== expectedOrigin) throw new Error('VITE_COS_MEDIA_ORIGIN 必须与 COS_BUCKET / COS_REGION 一致');
  const keyPrefix = environment.COS_KEY_PREFIX || 'ruleexam/dev/';
  if (!directoryPattern.test(keyPrefix)) throw new Error('COS_KEY_PREFIX 必须是有界相对目录前缀');
  const prefix = environment.VITE_COS_MEDIA_PREFIX || (origin ? `${keyPrefix}media/` : '');
  if (prefix && (!origin || !/^ruleexam\/[A-Za-z0-9_-]+\/media\/$/.test(prefix) || prefix.length > 1024 || prefix.split('/').some(part => part === 'identity' || part === 'staging'))) {
    throw new Error('VITE_COS_MEDIA_PREFIX 必须为 ruleexam/<环境>/media/ 正式目录，不能使用 identity/ 或 staging/');
  }
  if (origin && bucket && prefix !== `${keyPrefix}media/`) throw new Error('VITE_COS_MEDIA_PREFIX 必须与 COS_KEY_PREFIX 的正式 media/ 目录一致');
  return { origin, prefix };
}

export function serializePublicMediaEnv(config) {
  const safe = resolvePublicMediaConfig({ VITE_COS_MEDIA_ORIGIN: config.origin, VITE_COS_MEDIA_PREFIX: config.prefix });
  return `export VITE_COS_MEDIA_ORIGIN='${safe.origin}'\nexport VITE_COS_MEDIA_PREFIX='${safe.prefix}'\n`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) throw new Error('用法：node deploy/nginx/public-media-config.mjs <公开配置输出文件>');
  await writeFile(output, serializePublicMediaEnv(resolvePublicMediaConfig(process.env)), { mode: 0o644 });
}
