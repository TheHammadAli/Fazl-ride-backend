import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

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
