import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';

// Browsing a map: any point, not necessarily where the caller is standing
// (e.g. checking how many drivers are around before travelling to a city).
export class NearbyDriversQueryDto extends LatLngDto {
  // Not a fixed enum any more (see admin/vehicle-categories); an unknown
  // value here just matches no drivers instead of being rejected.
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50_000)
  radiusMeters?: number;
}
