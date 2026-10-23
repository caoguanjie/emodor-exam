import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { Errors } from '../../common/errors';
import { MediaService } from '../media/media.service';
import { MediaTicketService } from '../media/media-ticket.service';
import { IDENTITY_PROVIDER, IdentityImageType, IdentityMaterialError, IdentityProvider } from './identity-provider';

export async function sanitizeIdentityImage(bytes: Buffer, type: IdentityImageType): Promise<Buffer> {
  if (!bytes?.length) throw Errors.fileFormat('认证图片内容无效');
  if (bytes.length > 10 * 1024 * 1024) throw Errors.fileTooLarge();
  const maxPixels = type === 'face' ? 60_000_000 : 20_000_000;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning' }).metadata();
    if (!['jpeg', 'png'].includes(metadata.format || '') || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height || metadata.width < 320 || metadata.height < 320 || metadata.width * metadata.height > maxPixels) throw new Error();
    for (const quality of [85, 75, 65, 55]) {
      const output = await sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning', sequentialRead: true }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (Math.ceil(output.length / 3) * 4 <= 2_800_000) return output;
    }
    throw new Error();
  } catch { throw Errors.fileFormat('认证图片内容、尺寸或像素不符合要求'); }
}
@Injectable()
export class IdentityImageService {
  constructor(@Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider, private readonly media: MediaService, private readonly tickets: MediaTicketService) {}
  async upload(userId: string, type: IdentityImageType, bytes: Buffer) {
    if (!this.provider.enabled) throw Errors.serviceUnavailable('实名认证暂不可用');
    if (!['id_card_portrait', 'id_card_emblem', 'face'].includes(type)) throw Errors.param('认证图片类型无效');
    let processed = await sanitizeIdentityImage(bytes, type);
    if (type !== 'face') {
      if (!this.provider.cropDocument) throw Errors.serviceUnavailable('认证图片处理暂不可用');
      try { processed = await sanitizeIdentityImage(await this.provider.cropDocument(processed, type === 'id_card_portrait' ? 'FRONT' : 'BACK'), type); }
      catch (error) {
        if (error instanceof IdentityMaterialError) throw Errors.param('身份证图片未通过识别，请重新拍摄', { reason_code: error.reasonCode });
        throw error;
      }
    }
    const purpose = type === 'face' ? 'identity_face' : type === 'id_card_portrait' ? 'identity_id_portrait' : 'identity_id_emblem';
    const asset = await this.media.storeIdentityImage(userId, purpose, processed);
    return { asset_id: asset.assetId, image_type: type, scan_status: 'safe' as const,
      processed_preview: type === 'face' ? null : await this.tickets.issue(userId, asset.assetId, 'identity_verification_user', userId) };
  }
}
