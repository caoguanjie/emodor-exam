export type CosMediaConfig = {
  provider: 'local' | 'cos';
  bucket: string | null;
  region: string | null;
  keyPrefix: string | null;
  secretId: string | null;
  secretKey: string | null;
  sessionToken: string | null;
};

export function readCosMediaConfig(env: NodeJS.ProcessEnv): CosMediaConfig {
  const provider = env.MEDIA_STORAGE_PROVIDER || 'local';
  if (provider !== 'local' && provider !== 'cos') throw new Error('MEDIA_STORAGE_PROVIDER 只支持 local 或 cos');
  const value = (name: string) => env[name]?.trim() ? env[name]! : null;
  const config: CosMediaConfig = {
    provider, bucket: value('COS_BUCKET'), region: value('COS_REGION'), keyPrefix: value('COS_KEY_PREFIX'),
    secretId: value('COS_SECRET_ID'), secretKey: value('COS_SECRET_KEY'), sessionToken: value('COS_SESSION_TOKEN'),
  };
  if (provider === 'cos') {
    for (const [name, field] of [['COS_BUCKET','bucket'],['COS_REGION','region'],['COS_KEY_PREFIX','keyPrefix'],['COS_SECRET_ID','secretId'],['COS_SECRET_KEY','secretKey']] as const) {
      if (!config[field]) throw new Error(`必须显式配置环境变量 ${name}`);
    }
  }
  if (config.keyPrefix && !/^(?:[A-Za-z0-9_-]+\/)+$/.test(config.keyPrefix)) throw new Error('COS_KEY_PREFIX 必须是有界相对目录前缀并以 / 结尾');
  if (config.bucket && !/^[a-z0-9][a-z0-9-]*-\d+$/.test(config.bucket)) throw new Error('COS_BUCKET 格式无效');
  if (config.region && !/^[a-z][a-z0-9-]+$/.test(config.region)) throw new Error('COS_REGION 格式无效');
  return config;
}
