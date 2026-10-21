import { describe, expect, it } from 'vitest';
import { PdfVisionService } from '../src/modules/ai/pdf-vision.service';

const config = {
  upload: { dir: './data/uploads' },
  ai: {
    multimodalEnabled: true,
    multimodalTriggerChars: 1000,
    multimodalPagesPerRequest: 4,
    multimodalDpi: 144,
    multimodalMaxImageBytes: 6 * 1024 * 1024,
    multimodalMaxPages: 200,
  },
} as any;

describe('PdfVisionService 多模态触发条件', () => {
  it('PDF 文本不足时自动启用视觉输入', () => {
    const service = new PdfVisionService(config);
    expect(service.shouldUseVision({ fileType: 'pdf' } as any, '封面标题')).toBe(true);
  });

  it('文本充分或非 PDF 不切换视觉输入', () => {
    const service = new PdfVisionService(config);
    expect(service.shouldUseVision({ fileType: 'pdf' } as any, 'x'.repeat(1000))).toBe(false);
    expect(service.shouldUseVision({ fileType: 'docx' } as any, '')).toBe(false);
  });

  it('可通过配置关闭视觉输入', () => {
    const service = new PdfVisionService({ ...config, ai: { ...config.ai, multimodalEnabled: false } });
    expect(service.shouldUseVision({ fileType: 'pdf' } as any, '')).toBe(false);
  });
});
