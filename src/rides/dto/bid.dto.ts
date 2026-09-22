import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// A driver's answer to a negotiable ride: their own price, or the ride's
// offeredFare again if they are happy to take it as it stood.
export class BidDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount: number;
}

// The passenger picking one of the offers/bids they were sent.
export class ChooseOfferDto {
  @IsUUID()
  offerId: string;
}

// While still waiting for responses: raise/lower the price, or turn
// auto-accept on/off. At least one of the two should be sent.
export class UpdateOfferDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount?: number;

  @IsOptional()
  @IsBoolean()
  autoAccept?: boolean;
}
