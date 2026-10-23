import { IsIn, IsString, Matches } from 'class-validator';
export class IdentityImageDto {
  @IsString() @IsIn(['id_card_portrait', 'id_card_emblem', 'face']) image_type!: 'id_card_portrait' | 'id_card_emblem' | 'face';
}
export class IdentitySessionCreateDto {
  @IsString() @Matches(/^[1-9]\d{0,19}$/) face_asset_id!: string;
  @IsString() @Matches(/^[1-9]\d{0,19}$/) id_card_portrait_asset_id!: string;
  @IsString() @Matches(/^[1-9]\d{0,19}$/) id_card_emblem_asset_id!: string;
}
