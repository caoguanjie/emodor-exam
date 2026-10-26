export type MediaTicketView = { content_url: string; expires_at: string };
export type MediaTicketRequest = { asset_id: string; owner_type: string; owner_id: string };
export type MediaBatchResult = MediaTicketRequest & {
  index: number;
  ticket: MediaTicketView | null;
  error: { code: number; message: string } | null;
};
export type MediaDeliverySettings = { mode: 'proxy' | 'cos-signed'; readUrlTtlSeconds: number; videoUrlTtlSeconds: number };

export function mediaDeliverySettings(config: { mediaDelivery?: MediaDeliverySettings }): MediaDeliverySettings {
  const settings = config.mediaDelivery ?? { mode: 'proxy', readUrlTtlSeconds: 300, videoUrlTtlSeconds: 300 };
  if (!['proxy', 'cos-signed'].includes(settings.mode)
    || ![settings.readUrlTtlSeconds, settings.videoUrlTtlSeconds].every((value) => Number.isInteger(value) && value >= 1 && value <= 3600)) {
    throw new Error('媒体读取配置无效');
  }
  return settings;
}
