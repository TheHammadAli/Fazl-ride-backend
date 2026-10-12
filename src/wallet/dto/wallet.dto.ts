import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';
import {
  WalletRequestKind,
  WalletRequestStatus,
} from '../../generated/prisma/enums.js';

// Where money is sent from (top-up) or to (withdrawal).
export const PAYMENT_CHANNELS = ['jazzcash', 'easypaisa', 'bank'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class TopupRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount: number;

  @IsIn(PAYMENT_CHANNELS)
  method: PaymentChannel;

  // The transfer's transaction id, so the admin can find it.
  @IsString()
  @MinLength(4)
  @MaxLength(60)
  reference: string;

  // From POST wallet/proof.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  proofKey?: string;
}

export class WithdrawalRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount: number;

  @IsIn(PAYMENT_CHANNELS)
  method: PaymentChannel;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  accountTitle: string;

  // A mobile wallet number or an IBAN / account number.
  @IsString()
  @Matches(/^[A-Za-z0-9 -]{6,34}$/, {
    message: 'Enter a valid account or mobile number',
  })
  accountNumber: string;
}

// Driver: the change from a cash fare, put into the passenger's wallet.
export class AddChangeDto {
  @IsUUID()
  rideId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  amount: number;
}

export class AdminRequestsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(Object.values(WalletRequestKind))
  kind?: WalletRequestKind;

  @IsOptional()
  @IsIn(Object.values(WalletRequestStatus))
  status?: WalletRequestStatus;
}

export class ApproveRequestDto {
  // Withdrawal: the payout's transaction id.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;
}

export class RejectRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class AdminWalletsQueryDto extends PageQueryDto {
  // Name or phone.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  // Only drivers below the minimum balance.
  @IsOptional()
  @IsIn(['true', 'false'])
  dues?: 'true' | 'false';
}

export class AdjustWalletDto {
  // Signed: positive adds, negative takes away.
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  amount: number;

  @IsIn(['adjustment', 'refund'])
  type: 'adjustment' | 'refund';

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  note: string;
}

export class UpdateWalletSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  commissionPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(-100_000)
  @Max(0)
  driverMinBalance?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  minTopup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxTopup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  minWithdrawal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  maxChange?: number;

  @IsOptional()
  @IsBoolean()
  walletPaymentsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  topupInstructions?: string;
}
