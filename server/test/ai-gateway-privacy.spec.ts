import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { AiGatewayService } from '../src/modules/ai/ai-gateway.service';

const REFERENCE_CANARY = 'REFERENCE_CANARY_PRIVATE_QUESTION_CONTENT';

function fixture() {
  const gateway = new AiGatewayService({ load: async () => ({
    base_url: 'http://127.0.0.1:9101', api_key: 'non-live-test-placeholder', model: 'mock',
  }) } as any, { ai: { timeoutMs: 120_000, egressAllowHosts: ['127.0.0.1'] } } as any);
  const logs: unknown[] = [];
  vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => { logs.push(args); });
  return { gateway, logs };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI gateway privacy at the provider error boundary', () => {
  it('keeps a 200 non-JSON response that echoes reference content out of logs and the thrown error', async () => {
    vi.useFakeTimers();
    const { gateway, logs } = fixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`${REFERENCE_CANARY}: invalid json`, { status: 200 })));
    const result = gateway.chat([{ role: 'user', content: REFERENCE_CANARY }]).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await result;
    expect(error).toMatchObject({ code: 50002, message: expect.stringContaining('响应不是合法 JSON') });
    expect(JSON.stringify({ logs, message: error.message, stack: error.stack })).not.toContain(REFERENCE_CANARY);
    expect(logs).toHaveLength(1);
  });

  it('classifies untrusted transport errors without logging or returning their original message', async () => {
    vi.useFakeTimers();
    const { gateway, logs } = fixture();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`provider ${REFERENCE_CANARY}`); }));
    const result = gateway.chat([{ role: 'user', content: REFERENCE_CANARY }]).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await result;
    expect(error).toMatchObject({ code: 50002, message: expect.stringContaining('网络异常') });
    expect(JSON.stringify({ logs, message: error.message, stack: error.stack })).not.toContain(REFERENCE_CANARY);
  });

  it.each(['test', 'testVision'] as const)('keeps provider response diagnostics out of %s errors', async (method) => {
    const { gateway, logs } = fixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`${REFERENCE_CANARY}: bad response`, { status: 200 })));
    const error = await gateway[method]().catch((error) => error);
    expect(error).toMatchObject({ code: 50005, message: expect.stringContaining('响应不是合法 JSON') });
    expect(JSON.stringify({ logs, message: error.message, stack: error.stack })).not.toContain(REFERENCE_CANARY);
  });

  it.each([401, 429, 503])('preserves the fixed HTTP %s failure classification without retaining the body', async (status) => {
    vi.useFakeTimers();
    const { gateway, logs } = fixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REFERENCE_CANARY, { status })));
    const result = gateway.chat([{ role: 'user', content: REFERENCE_CANARY }]).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await result;
    expect(error).toMatchObject({ code: 50002, message: expect.stringContaining(`HTTP ${status}`) });
    expect(JSON.stringify({ logs, message: error.message, stack: error.stack })).not.toContain(REFERENCE_CANARY);
  });
});
