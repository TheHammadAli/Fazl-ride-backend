import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { SafetyAlertStatus } from '../../generated/prisma/enums.js';

export class RaiseSosDto extends LatLngDto {
  // The ride it is about; left out, the person's ride under way is used.
  @IsOptional()
  @IsUUID()
  rideId?: string;
}

export class SosLocationDto extends LatLngDto {}

export class ListSafetyAlertsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(SafetyAlertStatus)
  status?: SafetyAlertStatus;

  // Open or acknowledged: still needs someone.
  @IsOptional()
  @IsString()
  active?: string;
}

export class ResolveSafetyAlertDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  resolution: string;
}
