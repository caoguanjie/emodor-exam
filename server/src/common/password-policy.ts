import { Errors } from './errors';

/**
 * 密码强度策略（07 册 2.2.2）：≥8 位、含字母与数字、非常见弱口令、
 * 不含用户名/工号/姓名连续 3 位字符子串。
 * 改密（auth）、管理员创建/重置（users）统一复用，杜绝「业务层弱于认证层」的口径裂缝。
 */
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '1234567', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc123', 'abc123456', '111111', '000000', '121212', '123123', '123321',
  '654321', '666666', '888888', 'iloveyou', 'admin', 'admin1', 'admin123', 'root', 'toor', 'pass',
  'passw0rd', 'test', 'test123', 'guest', 'welcome', 'welcome1', 'monkey', 'dragon', 'sunshine',
  'princess', 'letmein', 'football', 'baseball', 'master', 'a123456', 'a12345678', 'qwe123',
]);

/** label：报错文案主语（改密「新密码」/ 管理员设置「初始密码」） */
export function validatePasswordStrength(
  password: string,
  user?: { username?: string; employeeNo?: string | null; realName?: string },
  label = '新密码',
) {
  if (password.length < 8) throw Errors.param(`${label}长度至少 8 位`);
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw Errors.param(`${label}须同时包含字母与数字`);
  if (WEAK_PASSWORDS.has(password.toLowerCase())) throw Errors.param(`${label}过于常见，请更换`);
  if (user) {
    const parts = [user.username, user.employeeNo, user.realName].filter(Boolean) as string[];
    for (const p of parts) {
      for (let i = 0; i + 3 <= p.length; i++) {
        const sub = p.slice(i, i + 3).toLowerCase();
        if (sub.length >= 3 && password.toLowerCase().includes(sub)) {
          throw Errors.param(`${label}不得包含用户名 / 工号 / 姓名的连续 3 位字符`);
        }
      }
    }
  }
}
