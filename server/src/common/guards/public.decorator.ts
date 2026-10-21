export const PUBLIC_KEY = 'is_public';
/** 标记公开接口（登录 / 刷新 / 健康检查），豁免 JWT 认证（04 册 6.1） */
export const Public = (): MethodDecorator => (target, key, desc) => {
  Reflect.defineMetadata(PUBLIC_KEY, true, desc.value!);
  return desc;
};
