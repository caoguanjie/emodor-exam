import { defineStore } from 'pinia';
import http, { tryRefresh } from '../api/http';

export interface AuthUser {
  id: number;
  username: string;
  real_name: string;
  employee_no: string | null;
  department_id: number | null;
  role: 'super_admin' | 'regulation_admin' | 'employee';
  permissions?: string[];
  force_password_change?: boolean;
  login_count?: number;
  last_login_at?: string | null;
  last_login_ip?: string | null;
}

/** 会话状态（双令牌：access 内存持有，refresh 经 HttpOnly Cookie） */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: sessionStorage.getItem('re_token') || '',
    user: JSON.parse(sessionStorage.getItem('re_user') || 'null') as AuthUser | null,
    needChangePassword: sessionStorage.getItem('re_pwd_pending') === '1',
  }),
  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    isAdmin: (s) => !!s.user && (s.user.role === 'super_admin' || s.user.role === 'regulation_admin' || (s.user.permissions?.length || 0) > 0),
    isSuperAdmin: (s) => !!s.user && s.user.role === 'super_admin',
    can: (s) => (code: string) => s.user?.role === 'super_admin' || !!s.user?.permissions?.includes(code),
  },
  actions: {
    setAccessToken(token: string) {
      this.accessToken = token;
      sessionStorage.setItem('re_token', token);
    },
    setPwdPending(v: boolean) {
      this.needChangePassword = v;
      sessionStorage.setItem('re_pwd_pending', v ? '1' : '0');
    },
    async login(username: string, password: string, captchaId?: string, captchaCode?: string) {
      const body: Record<string, string> = { username, password };
      if (captchaId) body.captcha_id = captchaId;
      if (captchaCode) body.captcha_code = captchaCode;
      const d: any = await http.post('/auth/login', body);
      this.setAccessToken(d.access_token);
      this.user = d.user;
      this.setPwdPending(!!d.force_change_password);
      sessionStorage.setItem('re_user', JSON.stringify(d.user));
      return d;
    },
    async changePassword(oldPassword: string, newPassword: string) {
      const d: any = await http.put('/auth/password', { old_password: oldPassword, new_password: newPassword });
      this.setAccessToken(d.access_token);
      this.setPwdPending(false);
      // 改密成功后刷新个人信息
      await this.fetchProfile();
    },
    async fetchProfile() {
      const u: any = await http.get('/auth/profile');
      this.user = u;
      sessionStorage.setItem('re_user', JSON.stringify(u));
    },
    /** 新标签页恢复会话：access token 在 sessionStorage（标签页隔离），凭 refresh Cookie 静默续登 */
    async restore(): Promise<boolean> {
      if (this.isLoggedIn) return true;
      const ok = await tryRefresh();
      if (!ok) return false;
      // 受限令牌（pwd_pending）拉 profile 会被后端守卫拒绝：视为已恢复，交由路由守卫跳 /change-password
      if (this.needChangePassword) return true;
      try {
        await this.fetchProfile();
        return true;
      } catch {
        return false;
      }
    },
    async logout() {
      try {
        await http.post('/auth/logout');
      } catch { /* 忽略登出网络错误 */ }
      this.logoutLocal();
    },
    logoutLocal() {
      this.accessToken = '';
      this.user = null;
      this.needChangePassword = false;
      sessionStorage.removeItem('re_token');
      sessionStorage.removeItem('re_user');
      sessionStorage.removeItem('re_pwd_pending');
    },
  },
});
