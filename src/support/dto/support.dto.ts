import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import {
  SupportPriority,
  SupportTicketStatus,
} from '../../generated/prisma/enums.js';

export class CreateTicketDto {
  @IsString()
  category: string;

  @IsOptional()
  @IsUUID()
  rideId?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  // Which side of the app it comes from, when it is not about a ride.
  @IsOptional()
  @IsIn(['passenger', 'driver'])
  as?: 'passenger' | 'driver';
}

export class TicketMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}

export class CategoriesQueryDto {
  @IsOptional()
  @IsIn(['passenger', 'driver'])
  role?: 'passenger' | 'driver';
}

export class ListTicketsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(SupportTicketStatus)
  status?: SupportTicketStatus;

  @IsOptional()
  @IsEnum(SupportPriority)
  priority?: SupportPriority;

  @IsOptional()
  @IsString()
  category?: string;

  // Ticket number, a name or phone, or words in the description.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(SupportPriority)
  priority?: SupportPriority;

  // Back to open, or in progress; resolving has its own route.
  @IsOptional()
  @IsIn(['open', 'in_progress'])
  status?: 'open' | 'in_progress';
}

export class ResolveTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolution: string;

  // Whole PKR into the person's wallet.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50_000)
  refundAmount?: number;
}
