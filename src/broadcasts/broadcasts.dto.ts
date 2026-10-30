import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto.js';

export const BROADCAST_AUDIENCES = [
  'all',
  'passengers',
  'drivers',
  'online_drivers',
] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export class SendBroadcastDto {
  // Phones cut a notification title at about 50 characters.
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  title: string;

  @IsString()
  @MinLength(2)
  @MaxLength(240)
  body: string;

  @IsIn(BROADCAST_AUDIENCES)
  audience: BroadcastAudience;
}

export class ListBroadcastsDto extends PaginationDto {}
