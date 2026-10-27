import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';

/**
 * 请求封装（04 册 1.2 统一信封 + 07 册 2.1.2 无感刷新）：
 * Bearer 认证 → 401 时以 HttpOnly refresh Cookie 静默刷新并重放 → 业务码非 0 统一提示。
 */
const http = axios.create({ baseURL: '/api/v1', timeout: 60000 });

/** Build a same-origin URL for raw/public endpoints that are not envelope requests. */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/api/v1${normalized}`;
}

export function publicSiteAssetUrl(assetId: string): string {
  return apiUrl(`/site-config/assets/${encodeURIComponent(assetId)}/content`);
}

let refreshing: Promise<boolean> | null = null;

/** 以 HttpOnly refresh Cookie 静默换取新 access token（供 401 拦截与新标签页恢复会话复用） */
export async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = axios
      .post('/api/v1/auth/refresh', null, { withCredentials: true })
      .then((res) => {
        const d = res.data?.data;
        if (d?.access_token) {
          const s = useAuthStoreRaw();
          s.setAccessToken(d.access_token);
          // refresh 响应携带首登强制改密标志：必须落地，否则受限令牌拉 profile 被拒会被误判为未登录
          s.setPwdPending(!!d.force_change_password);
          return true;
        }
        return false;
      })
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

// 延迟引入避免循环依赖
import { useAuthStore } from '../stores/auth';
function useAuthStoreRaw() {
  return useAuthStore();
}

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  async (res) => {
    // 二进制流（Excel / PDF）直接返回
    if (res.config.responseType === 'blob' || res.data instanceof Blob) return res;
    const body = res.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data;
      ElMessage.error(body.message || '请求失败');
      return Promise.reject(new ApiError(body.code, body.message, body.data));
    }
    return body;
  },
  async (err: AxiosError) => {
    if (axios.isCancel(err)) return Promise.reject(err);
    const config = err.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const status = err.response?.status;
    const body: any = err.response?.data;
    const code = body?.code;
    if (status === 401 && config && !config._retried && !String(config.url).includes('/auth/login')) {
      // 40102 过期 / 40107 吊销(仅 refresh 场景) → 静默刷新重放；刷新失败跳登录
      config._retried = true;
      const ok = await tryRefresh();
      if (ok) return http(config);
      useAuthStore().logoutLocal();
      if (!location.pathname.startsWith('/login')) location.href = '/login';
      return Promise.reject(err);
    }
    if (status === 403 && config && !String(config.url).includes('/auth/profile') && !String(config.url).includes('/auth/login')) {
      // A permission change can leave a rendered page with stale buttons until
      // the next router navigation. Refresh the principal after the first
      // authorization failure; the server remains the final authority.
      try { await useAuthStore().fetchProfile(); } catch { /* keep the original 403 */ }
    }
    const msg = body?.message || err.message || '网络异常';
    ElMessage.error(msg);
    return Promise.reject(new ApiError(code ?? status ?? 0, msg, body?.data));
  },
);

export class ApiError extends Error {
  constructor(public code: number, message: string, public data?: any) {
    super(message);
  }
}

/** 文件下载（Excel 导出 / 模板） */
export async function download(url: string, filename: string, params?: Record<string, any>) {
  const res: any = await http.get(url, { responseType: 'blob', params });
  // blob 响应经响应拦截器原样返回 AxiosResponse，二进制本体在 data 中
  const blob: Blob = res instanceof Blob ? res : res?.data;
  if (!(blob instanceof Blob)) throw Object.assign(new Error('下载响应不是文件流'), { code: 0 });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 文件上传（multipart） */
export async function upload(url: string, file: File, field = 'file', fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append(field, file);
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  const res = await http.post(url, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res;
}

export default http;
