import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import QRCode from 'qrcode';
import ExamEntryQrDialog from '../../ExamEntryQrDialog.vue';
import { buildExamEntryUrl } from '../../../utils/exam-entry-url';

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function show(baseUrl: string) {
  const wrapper = mount(ExamEntryQrDialog, { props: { modelValue: true, baseUrl }, attachTo: document.body, global: { plugins: [ElementPlus] } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}

describe('shared H5 exam entry URL', () => {
  it.each([
    ['https://exam.example/mobile/', 'https://exam.example/mobile/#/pages/exam/index'],
    ['https://exam.example/training/mobile', 'https://exam.example/training/mobile/#/pages/exam/index'],
    ['https://exam.example/mobile/index.html', 'https://exam.example/mobile/index.html#/pages/exam/index'],
    ['https://exam.example', 'https://exam.example/#/pages/exam/index'],
  ])('keeps the deployment base path in %s', (base, expected) => {
    expect(buildExamEntryUrl(base)).toBe(expected);
    const url = new URL(buildExamEntryUrl(base));
    expect(url.search).toBe(''); expect(url.hash).toBe('#/pages/exam/index');
  });
  it.each(['', '  ', '/mobile/', 'javascript:alert(1)', 'file:///mobile/', 'https://user:pass@exam.example/mobile/',
    'https://exam.example/mobile/?paper_id=1', 'https://exam.example/mobile/?token=secret', 'https://exam.example/mobile/#/pages/exam/take?record_id=1',
    'http://localhost:5174/mobile/', 'http://127.0.0.1/mobile/', 'http://[::1]/mobile/'])('rejects missing or unsafe public base %s', base => {
    expect(() => buildExamEntryUrl(base)).toThrow();
  });
});

describe('shared exam entry QR dialog', () => {
  it('renders a locally generated image and downloads the same generic entry without any paper or auth parameter', async () => {
    const renderer = vi.spyOn(QRCode, 'toString');
    const wrapper = await show('https://exam.example/mobile/');
    const dialog = document.querySelector('.exam-entry-qr-dialog')!;
    expect(dialog.textContent).toContain('扫码进入考试列表');
    expect(dialog.textContent).toContain('https://exam.example/mobile/#/pages/exam/index');
    expect(renderer).toHaveBeenCalledWith('https://exam.example/mobile/#/pages/exam/index', expect.objectContaining({ type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 320 }));
    const source = dialog.querySelector<HTMLImageElement>('img')!.src;
    expect(source.startsWith('data:image/svg+xml')).toBe(true);
    const svg = decodeURIComponent(source.split(',')[1]!);
    expect(svg).toContain('<svg'); expect(svg).toContain('<path');
    expect(svg).not.toMatch(/paper_id|token=|jwt=|phone=|record_id/);
    let downloaded: { href: string; name: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = { href: this.href, name: this.download }; });
    const download = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '下载二维码')!;
    download.click(); await flushPromises();
    expect(downloaded).toEqual({ href: source, name: '考试入口二维码.svg' });
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
  it('shows the deployment configuration requirement and never falls back to the administrator location', async () => {
    await show('');
    const dialog = document.querySelector('.exam-entry-qr-dialog')!;
    expect(dialog.textContent).toContain('VITE_PUBLIC_H5_BASE_URL');
    expect(dialog.querySelector('img')).toBeNull();
    const download = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '下载二维码')!;
    expect(download.disabled).toBe(true);
  });
  it('discards a late renderer result after closing or changing the configured base', async () => {
    const realRender = QRCode.toString.bind(QRCode);
    let complete!: (image: string) => void;
    vi.spyOn(QRCode, 'toString').mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; }) as any);
    const wrapper = await show('https://old.example/mobile/');
    await wrapper.setProps({ modelValue: false }); await wrapper.setProps({ modelValue: true, baseUrl: 'https://new.example/h5/' }); await flushPromises();
    complete(await realRender('old', { type: 'svg' })); await flushPromises();
    const dialog = document.querySelector('.exam-entry-qr-dialog')!;
    expect(dialog.textContent).toContain('https://new.example/h5/#/pages/exam/index');
    expect(dialog.textContent).not.toContain('https://old.example');
    expect(dialog.querySelector('img')).not.toBeNull();
  });
  it('offers retry after a local renderer failure without exposing an incomplete download', async () => {
    vi.spyOn(QRCode, 'toString').mockRejectedValueOnce(new Error('renderer unavailable'));
    await show('https://exam.example/mobile/');
    const dialog = document.querySelector('.exam-entry-qr-dialog')!;
    expect(dialog.textContent).toContain('生成失败'); expect(dialog.querySelector('img')).toBeNull();
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '重试')!.click();
    await flushPromises(); expect(dialog.querySelector('img')).not.toBeNull();
  });
});
