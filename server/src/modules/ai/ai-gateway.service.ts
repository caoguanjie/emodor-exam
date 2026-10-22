import { Injectable, Logger } from '@nestjs/common';
import { AiConfigService, AiConfigValue } from './ai-config.service';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { assertPublicHttpUrl } from './url-guard';

export type ChatMessageContent = string | ChatMessageContentPart[];

export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user';
  /** OpenAI 兼容协议既支持纯文本，也支持 text + image_url 多模态内容块。 */
  content: ChatMessageContent;
}

type GatewayFailureKind = 'http' | 'invalid_json' | 'invalid_response' | 'timeout' | 'cancelled' | 'network' | 'endpoint';

/** Provider payloads and thrown messages must never become diagnostics. */
class GatewayFailure extends Error {
  constructor(readonly kind: GatewayFailureKind, readonly status?: number) {
    super(kind);
  }
}

function failureMessage(error: unknown): string {
  if (!(error instanceof GatewayFailure)) return '网络异常';
  switch (error.kind) {
    case 'http': return `AI HTTP ${error.status}`;
    case 'invalid_json': return 'AI 响应不是合法 JSON';
    case 'invalid_response': return 'AI 响应缺少有效的消息内容';
    case 'timeout': return 'AI 调用超时';
    case 'cancelled': return 'AI 调用已取消';
    case 'endpoint': return 'AI 目标地址不允许或配置无效';
    case 'network': return '网络异常';
  }
}

/**
 * AI 网关服务（05 册 4.4.1）：OpenAI 兼容协议 HTTP 客户端。
 * POST {base_url}/chat/completions（Authorization: Bearer {api_key}）；
 * 120 秒硬超时（NFR-05）；可重试错误（网络/5xx/429）指数退避重试 ≤ 2 次（2s、8s）；
 * 4xx 立即报错不消耗重试；非流式（stream=false，结果整体校验后落库）。
 * base_url 为具备 ai_config:write 权限的管理端显式配置的受信端点（仅允许 http/https 协议）。
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private static readonly RETRY_DELAYS_MS = [2000, 8000];

  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly config: AppConfig,
  ) {}

  private async callOnce(cfg: AiConfigValue, messages: ChatMessage[], temperature: number, signal?: AbortSignal): Promise<any> {
    // 发请求前校验目标主机：拒绝 localhost/环回/私有/保留地址（含环境变量兜底路径的纵深防御）；
    // AI_EGRESS_ALLOW_HOSTS 白名单命中时放行（本地开发/测试 Mock AI 专用）
    try { assertPublicHttpUrl(cfg.base_url, this.config.ai.egressAllowHosts); }
    catch { throw new GatewayFailure('endpoint'); }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), this.config.ai.timeoutMs);
    try {
      const url = `${cfg.base_url.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.api_key}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature,
          stream: false,
        }),
      });
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          if (controller.signal.aborted) throw new GatewayFailure(signal?.aborted ? 'cancelled' : 'timeout');
          // Native SyntaxError.message can quote the raw response. Do not keep
          // it as cause, log it, or pass it into a business exception.
          throw new GatewayFailure('invalid_json');
        }
      }
      // 4xx 鉴权/参数错误不可重试；5xx/429 归入可重试分类
      // Error bodies may echo reference questions. Cancel without reading them.
      await res.body?.cancel().catch(() => undefined);
      throw new GatewayFailure('http', res.status);
    } catch (error) {
      if (error instanceof GatewayFailure) throw error;
      if (controller.signal.aborted) throw new GatewayFailure(signal?.aborted ? 'cancelled' : 'timeout');
      throw new GatewayFailure('network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  /** 单次补全调用（含超时与重试策略） */
  async chat(messages: ChatMessage[], temperature = 0.4, signal?: AbortSignal): Promise<string> {
    const cfg = await this.aiConfig.load();
    if (!cfg) throw Errors.aiNotConfigured();
    let lastErr: any = null;
    for (let attempt = 0; attempt <= AiGatewayService.RETRY_DELAYS_MS.length; attempt++) {
      try {
        if (signal?.aborted) throw new GatewayFailure('cancelled');
        const body = await this.callOnce(cfg, messages, temperature, signal);
        const content = body?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new GatewayFailure('invalid_response');
        return content;
      } catch (e: any) {
        lastErr = e;
        // 超时明确报错可重试（NFR-05）：由任务层整块重试，网关内不退避
        if (signal?.aborted || e instanceof GatewayFailure && ['timeout', 'cancelled'].includes(e.kind)) {
          break;
        }
        const status = e instanceof GatewayFailure ? e.status : undefined;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt === AiGatewayService.RETRY_DELAYS_MS.length) break;
        await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, AiGatewayService.RETRY_DELAYS_MS[attempt]);
          signal?.addEventListener('abort', finish, { once: true });
          if (signal?.aborted) finish();
        });
      }
    }
    const message = failureMessage(lastErr);
    this.logger.error(`AI 调用失败: ${message}`);
    throw Errors.aiCallFailed(`AI 服务调用失败：${message}`);
  }

  /** 连通性测试（FR-AIQ-01 验收①）：最小 messages 走真实调用链路 */
  async test(): Promise<void> {
    const cfg = await this.aiConfig.load();
    if (!cfg) throw Errors.aiNotConfigured();
    try {
      await this.callOnce(cfg, [{ role: 'user', content: '请回复 OK' }], 0);
    } catch (error) {
      throw Errors.aiTestFailed(`连通性测试失败：${failureMessage(error)}`);
    }
  }

  /** 多模态连通性测试：发送 1×1 PNG，不上传业务制度内容。 */
  async testVision(): Promise<void> {
    const cfg = await this.aiConfig.load();
    if (!cfg) throw Errors.aiNotConfigured();
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    try {
      const body = await this.callOnce(cfg, [{
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张图片并只回复 OK。' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${pixel}` } },
        ],
      }], 0);
      if (typeof body?.choices?.[0]?.message?.content !== 'string') {
        throw new GatewayFailure('invalid_response');
      }
    } catch (error) {
      throw Errors.aiTestFailed(`多模态测试失败：${failureMessage(error)}`);
    }
  }
}
