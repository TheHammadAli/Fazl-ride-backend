import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { RideStatus } from '../../generated/prisma/enums.js';

export class ListRidesDto extends PaginationDto {
  @IsOptional()
  @IsEnum(RideStatus)
  status?: RideStatus;

  // Not a fixed enum any more (see admin/vehicle-categories); an unknown
  // value here just matches no rides instead of being rejected.
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsUUID()
  passengerId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  // Requested at or after / before these moments (ISO 8601).
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
