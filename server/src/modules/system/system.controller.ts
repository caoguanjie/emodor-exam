import {
  Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res,
} from '@nestjs/common';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { Public } from '../../common/guards/public.decorator';
import { SkipEnvelope } from '../../common/response.interceptor';
import { AuditQueryService } from './audit-query.service';
import { SystemService } from './system.service';

const QueryNumber = () => Transform(({ value }) => (
  value === undefined || value === null || value === '' ? undefined : Number(value)
));

function assertRequestKeys(value: unknown, allowed: readonly string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label} 包含不支持的字段：${unknown.join(',')}`);
}

class MenuDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) parent_id?: string | null;
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsString() @IsIn(['directory', 'menu', 'button']) type!: 'directory' | 'menu' | 'button';
  @IsOptional() @IsString() @MaxLength(255) route_path?: string | null;
  @IsOptional() @IsString() @MaxLength(128) permission_code?: string | null;
  @IsOptional() @IsString() @MaxLength(64) icon?: string | null;
  @IsInt() @Min(0) @Max(100_000) sort!: number;
  @IsInt() @Min(0) @Max(1) status!: number;
}

class DictionaryDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{0,63}$/) type!: string;
  @IsString() @Matches(/^[a-z0-9][a-z0-9_.-]{0,63}$/) code!: string;
  @IsString() @MinLength(1) @MaxLength(128) label!: string;
  @IsInt() @Min(0) @Max(100_000) sort!: number;
  @IsInt() @Min(0) @Max(1) status!: number;
  @IsOptional() @IsString() @MaxLength(255) remark?: string | null;
}

class DictionaryQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(64) type?: string;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
  @IsOptional() @QueryNumber() @IsInt() @Min(0) @Max(1) status?: number;
}

class BannerDto {
  @IsString() @Matches(/^[1-9]\d*$/) asset_id!: string;
  @IsInt() @Min(0) @Max(100_000) sort!: number;
}

class SiteSettingsDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) logo_asset_id?: string | null;
  @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => BannerDto)
  banners!: BannerDto[];
}

class AuditQueryDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date_from?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date_to?: string;
  @IsOptional() @IsString() @MaxLength(128) actor?: string;
  @IsOptional() @IsString() @MaxLength(128) action?: string;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
}

@Controller('admin')
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly auditQuery: AuditQueryService,
  ) {}

  private actor(user: AuthUser) {
    return { id: String(user.id), name: user.username };
  }

  @Get('menus/navigation')
  navigation(@CurrentUser() user: AuthUser) {
    return this.system.navigation(String(user.id));
  }

  @Get('menus')
  @Permissions('system_settings:read')
  menus() {
    return this.system.menuTree({ includeButtons: true });
  }

  @Get('menus/permission-options')
  @Permissions('system_settings:write')
  permissionOptions() {
    return this.system.permissionOptions();
  }

  @Get('menus/:id')
  @Permissions('system_settings:read')
  menu(@Param('id') id: string) {
    return this.system.menuDetail(id);
  }

  @Post('menus')
  @Permissions('system_settings:write')
  createMenu(
    @Body(new StrictDtoValidationPipe(['parent_id', 'name', 'type', 'route_path', 'permission_code', 'icon', 'sort', 'status'])) dto: MenuDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.body, ['parent_id', 'name', 'type', 'route_path', 'permission_code', 'icon', 'sort', 'status'], '菜单请求');
    return this.system.createMenu(dto, this.actor(user), req.ip || null);
  }

  @Put('menus/:id')
  @Permissions('system_settings:write')
  updateMenu(
    @Param('id') id: string,
    @Body(new StrictDtoValidationPipe(['parent_id', 'name', 'type', 'route_path', 'permission_code', 'icon', 'sort', 'status'])) dto: MenuDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.body, ['parent_id', 'name', 'type', 'route_path', 'permission_code', 'icon', 'sort', 'status'], '菜单请求');
    return this.system.updateMenu(id, dto, this.actor(user), req.ip || null);
  }

  @Delete('menus/:id')
  @Permissions('system_settings:write')
  removeMenu(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.system.removeMenu(id, this.actor(user), req.ip || null);
  }

  @Get('dictionaries')
  @Permissions('system_settings:read')
  dictionaries(
    @Query(new StrictDtoValidationPipe(['page', 'page_size', 'type', 'keyword', 'status'])) query: DictionaryQueryDto,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.query, ['page', 'page_size', 'type', 'keyword', 'status'], '字典查询');
    return this.system.listDictionaries(query);
  }

  @Post('dictionaries')
  @Permissions('system_settings:write')
  createDictionary(
    @Body(new StrictDtoValidationPipe(['type', 'code', 'label', 'sort', 'status', 'remark'])) dto: DictionaryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.body, ['type', 'code', 'label', 'sort', 'status', 'remark'], '字典请求');
    return this.system.createDictionary(dto, this.actor(user), req.ip || null);
  }

  @Put('dictionaries/:id')
  @Permissions('system_settings:write')
  updateDictionary(
    @Param('id') id: string,
    @Body(new StrictDtoValidationPipe(['type', 'code', 'label', 'sort', 'status', 'remark'])) dto: DictionaryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.body, ['type', 'code', 'label', 'sort', 'status', 'remark'], '字典请求');
    return this.system.updateDictionary(id, dto, this.actor(user), req.ip || null);
  }

  @Delete('dictionaries/:id')
  @Permissions('system_settings:write')
  removeDictionary(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.system.removeDictionary(id, this.actor(user), req.ip || null);
  }

  @Get('site-settings')
  @Permissions('system_settings:read')
  siteSettings() {
    return this.system.siteSettings();
  }

  @Put('site-settings')
  @Permissions('system_settings:write')
  updateSiteSettings(
    @Body(new StrictDtoValidationPipe(['logo_asset_id', 'banners'])) dto: SiteSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.body, ['logo_asset_id', 'banners'], '网站配置请求');
    const rawBanners = (req.body as { banners?: unknown })?.banners;
    if (Array.isArray(rawBanners)) {
      rawBanners.forEach((banner, index) => assertRequestKeys(banner, ['asset_id', 'sort'], `轮播项[${index}]`));
    }
    return this.system.updateSiteSettings(dto, this.actor(user), req.ip || null);
  }

  @Get('audit-logs')
  @Permissions('system_settings:read')
  auditLogs(
    @Query(new StrictDtoValidationPipe(['date_from', 'date_to', 'actor', 'action', 'page', 'page_size'])) query: AuditQueryDto,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.query, ['date_from', 'date_to', 'actor', 'action', 'page', 'page_size'], '审计查询');
    return this.auditQuery.list(query);
  }
}

@Controller('site-config')
export class SiteConfigController {
  constructor(private readonly system: SystemService) {}

  @Get()
  @Public()
  config() {
    return this.system.publicConfig();
  }

  @Get('assets/:id/content')
  @Public()
  @SkipEnvelope()
  async content(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const descriptor = await this.system.openPublicAsset(id, req.headers.range);
    const start = descriptor.range?.start ?? 0;
    const end = descriptor.range?.end ?? descriptor.size - 1;
    res.status(descriptor.range ? 206 : 200);
    res.setHeader('Content-Type', descriptor.asset.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(end - start + 1));
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (descriptor.range) res.setHeader('Content-Range', `bytes ${start}-${end}/${descriptor.size}`);
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(descriptor.path, { acceptRanges: true }, (error) => {
      if (error && !res.headersSent) res.status(404).end();
    });
  }
}
