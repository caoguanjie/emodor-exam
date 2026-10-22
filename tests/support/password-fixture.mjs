import { randomBytes } from 'node:crypto';

export function randomStrongPassword(...personalValues) {
  const forbidden = personalValues
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length >= 3)
    .flatMap((value) => Array.from(
      { length: value.length - 2 },
      (_, index) => value.slice(index, index + 3),
    ));
  while (true) {
    const password = `Q${randomBytes(16).toString('hex')}Z9`;
    if (!forbidden.some((value) => password.toLowerCase().includes(value))) return password;
  }
}
