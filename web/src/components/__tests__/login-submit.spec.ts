import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import Login from '../../views/Login.vue';

const mocks = vi.hoisted(() => ({ login: vi.fn(), post: vi.fn(), push: vi.fn() }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ login: mocks.login, needChangePassword: false, isAdmin: true }) }));
vi.mock('../../api/http', () => ({ default: { post: mocks.post } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }), useRoute: () => ({ query: {} }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.post.mockResolvedValue({ captcha_id: 'fresh-captcha', image: 'data:image/svg+xml;base64,', expires_in: 120 });
});

async function render() {
  const wrapper = mount(Login, { global: { plugins: [ElementPlus] } });
  await flushPromises();
  const inputs = wrapper.findAll('input');
  await inputs[0]!.setValue('test-admin');
  await inputs[1]!.setValue('fixture-only-password');
  await inputs[2]!.setValue('ABCD');
  return wrapper;
}

describe('administrator login submission', () => {
  it('sends one request when Enter and repeated form submissions occur before login completes', async () => {
    let finish!: () => void;
    mocks.login.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const wrapper = await render();
    try {
      await wrapper.get('form').trigger('submit');
      await wrapper.findAll('input')[2]!.trigger('keyup', { key: 'Enter' });
      await wrapper.get('form').trigger('submit');
      expect(mocks.login).toHaveBeenCalledTimes(1);
      finish();
      await flushPromises();
      expect(mocks.push).toHaveBeenCalledTimes(1);
    } finally { wrapper.unmount(); }
  });

  it('refreshes the consumed captcha and clears its answer after a failed login', async () => {
    mocks.login.mockRejectedValue(new Error('credentials rejected'));
    const wrapper = await render();
    try {
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(mocks.post).toHaveBeenLastCalledWith('/auth/captcha', { previous_captcha_id: 'fresh-captcha' });
      expect(mocks.post).toHaveBeenCalledTimes(2);
      expect(wrapper.findAll('input')[2]!.element.value).toBe('');
      expect(mocks.push).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
});
