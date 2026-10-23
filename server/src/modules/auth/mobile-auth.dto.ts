import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class MobilePhoneDto {
  @IsString() @MinLength(1) @MaxLength(32) phone!: string;
}

export class MobileSmsLoginDto extends MobilePhoneDto {
  @IsString() @Matches(/^[a-f0-9]{48}$/) challenge_id!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
