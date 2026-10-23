import { Errors } from '../../common/errors';

/** Phone is an authentication identifier: all write paths share this canonical form. */
export function normalizeChinaMobile(input: string): string {
  if (typeof input !== 'string') throw Errors.param('手机号格式不正确');
  const phone = input.replace(/[\s-]/g, '');
  if (!/^1[3-9]\d{9}$/.test(phone)) throw Errors.param('手机号格式不正确');
  return phone;
}

export function normalizeOptionalChinaMobile(input: string | null | undefined): string | null {
  if (input === null || input === undefined || (typeof input === 'string' && !input.trim())) return null;
  return normalizeChinaMobile(input);
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
