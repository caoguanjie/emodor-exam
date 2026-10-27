import type { ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { normalizeSiteAbout, type SiteAboutConfig } from './site-about-config';
import type { PublicSiteConfig } from './system.service';

const SITE_REQUEST_KEYS = ['logo_asset_id', 'banners', 'about'];
export type SiteSettingsInput = Partial<PublicSiteConfig>;

class BannerDto {
  @IsString() @Matches(/^[1-9]\d*$/) asset_id!: string;
  @IsInt() @Min(0) @Max(100_000) sort!: number;
}

export class SiteSettingsDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) logo_asset_id?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => BannerDto)
  banners?: BannerDto[];
  @IsOptional() @IsObject() about?: SiteAboutConfig;
}

export class SiteSettingsValidationPipe extends StrictDtoValidationPipe {
  constructor() { super(SITE_REQUEST_KEYS); }

  async transform(value: unknown, metadata: ArgumentMetadata) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param('网站配置请求必须是对象');
    const raw = value as Record<string, unknown>;
    if (!SITE_REQUEST_KEYS.some(key => raw[key] !== undefined)) throw Errors.param('网站配置请求不能为空');
    const safe = { ...raw };
    if (raw.logo_asset_id !== undefined && raw.logo_asset_id !== null && typeof raw.logo_asset_id !== 'string') throw Errors.param('Logo ID 必须是字符串或 null');
    if (raw.about !== undefined) safe.about = normalizeSiteAbout(raw.about);
    if (raw.banners !== undefined) {
      if (!Array.isArray(raw.banners) || raw.banners.length > 3) throw Errors.param('轮播配置必须是最多 3 项的数组');
      for (const banner of raw.banners) {
        if (!banner || typeof banner !== 'object' || Array.isArray(banner)
          || Object.keys(banner).some(key => !['asset_id', 'sort'].includes(key))) throw Errors.param('轮播项包含不支持的字段或结构非法');
        if (typeof banner.asset_id !== 'string' || typeof banner.sort !== 'number') throw Errors.param('轮播 ID 或排序类型非法');
      }
    }
    // The controller uses an interface metatype so the global pipe does not
    // recurse into unbounded raw JSON before this safety check runs.
    return super.transform(safe, { ...metadata, metatype: SiteSettingsDto });
  }
}
