import { describe, expect, it } from 'vitest';
import { assertCosMediaUrl } from '../src/platform/cos-media-url';
const origin = 'https://shared-123456.cos.ap-guangzhou.myqcloud.com';
const prefix = 'ruleexam/dev/media/';
const query = 'q-sign-algorithm=sha1&q-ak=unusable-fixture-id&q-sign-time=1793000000%3B1793000300&q-key-time=1793000000%3B1793000300&q-header-list=host&q-url-param-list=versionid&q-signature=' + 'a'.repeat(40) + '&versionId=fixture-version';
const signed = `${origin}/${prefix}session/file.mp4?${query}`;
describe('precise COS signed media URLs', () => {
  it('accepts the exact configured media origin/prefix and v5 signature query without changing it', () => {
    expect(assertCosMediaUrl(signed, origin, prefix)).toBe(signed);
    expect(assertCosMediaUrl(signed + '&response-content-disposition=inline%3B%20filename%3Dvideo.mp4&x-cos-security-token=unusable-sts-fixture', origin, prefix)).toContain('response-content-disposition');
  });
  it.each([
    signed.replace('shared-123456.', 'other-123456.'), signed.replace('.myqcloud.com/', '.myqcloud.com.evil/'),
    signed.replace('/dev/media/', '/prod/media/'), signed.replace('/media/', '/identity/'), signed.replace('/media/', '/staging/'),
    signed.replace('/session/', '/session/../'), signed.replace('/session/', '/session/%2e%2e/'),
    signed.replace('/session/', '/%6dedia/'), signed.replace('/session/', '/a%2fb/'), signed.replace('/session/', '/a\\b/'),
    signed.replace('https://', 'https://user@'), signed.replace('https://', 'http://'),
    signed + '#fragment', signed + '&jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturefixture',
    signed + '&q-signature=' + 'b'.repeat(40), signed + '&response-content-type=Bearer%20unusable-fixture',
    signed + '&x-cos-security-token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturefixture',
    signed.replace('q-sign-algorithm=sha1', 'q-sign-algorithm=sha256'), signed.replace('q-signature=' + 'a'.repeat(40), 'q-signature=invalid'),
    `${origin}/${prefix}session/file.mp4`,
  ])('rejects unapproved or normalization-changing addresses: %s', value => {
    expect(() => assertCosMediaUrl(value, origin, prefix)).toThrow();
  });
  it('fails closed when either public COS setting is absent or not an exact media location', () => {
    for (const [allowedOrigin, allowedPrefix] of [['', prefix], [origin, ''], ['https://*.myqcloud.com', prefix], [origin, 'ruleexam/dev/'], [origin, '../media/']]) {
      expect(() => assertCosMediaUrl(signed, allowedOrigin, allowedPrefix)).toThrow();
    }
  });
});
