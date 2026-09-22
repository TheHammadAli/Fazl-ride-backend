import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';
import { VehicleCategory } from '../../generated/prisma/enums.js';

// Browsing a map: any point, not necessarily where the caller is standing
// (e.g. checking how many drivers are around before travelling to a city).
export class NearbyDriversQueryDto extends LatLngDto {
  @IsOptional()
  @IsEnum(VehicleCategory)
  category?: VehicleCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50_000)
  radiusMeters?: number;
}
