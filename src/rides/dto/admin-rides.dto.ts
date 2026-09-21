import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { RideStatus, VehicleCategory } from '../../generated/prisma/enums.js';

export class ListRidesDto extends PaginationDto {
  @IsOptional()
  @IsEnum(RideStatus)
  status?: RideStatus;

  @IsOptional()
  @IsEnum(VehicleCategory)
  category?: VehicleCategory;

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
