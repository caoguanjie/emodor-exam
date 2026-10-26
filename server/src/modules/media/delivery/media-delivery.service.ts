import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { BizError, Errors } from '../../../common/errors';
import { MediaTicketService } from '../media-ticket.service';
import { MediaBatchResult, MediaTicketRequest } from './media-delivery.contract';
import { PcMediaTicketService } from './pc-media-ticket.service';

@Injectable()
export class MediaDeliveryService {
  constructor(private readonly learnerTickets: MediaTicketService, private readonly pcTickets: PcMediaTicketService) {}

  issuePreview(actor: AuthUser, assetId: string) { return this.pcTickets.issue(actor, assetId); }
  openPreview(ticket: string, range?: string) { return this.pcTickets.open(ticket, range); }

  async issueLearnerBatch(actor: AuthUser, items: MediaTicketRequest[]): Promise<MediaBatchResult[]> {
    if (actor.client !== 'mobile') throw Errors.forbidden();
    if (!Array.isArray(items) || items.length > 50) throw Errors.param('媒体票据批量请求最多 50 项');
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).some((name) => !['asset_id', 'owner_type', 'owner_id'].includes(name))
        || ![item.asset_id, item.owner_id].every((value) => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value))
        || typeof item.owner_type !== 'string' || !item.owner_type || item.owner_type.length > 64) throw Errors.param('媒体票据请求非法');
    }
    // Keep every input position, including duplicates. Owner authorization is
    // deliberately performed for each tuple rather than cached by asset id.
    return Promise.all(items.map(async (item, index) => {
      try {
        const ticket = await this.learnerTickets.issue(String(actor.id), item.asset_id, item.owner_type, item.owner_id);
        return { ...item, index, ticket, error: null };
      } catch (error) {
        const safe = error instanceof BizError ? error : Errors.serviceUnavailable('媒体票据暂不可用');
        return { ...item, index, ticket: null, error: { code: safe.code, message: safe.message } };
      }
    }));
  }
}
