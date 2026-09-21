import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';

export class EstimateRideDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => LatLngDto)
  pickup: LatLngDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => LatLngDto)
  dropoff: LatLngDto;
}
