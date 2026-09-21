import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { DriverStatus } from '../../generated/prisma/enums.js';

export class ListDriversDto extends PaginationDto {
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}

export class ListUsersDto extends PaginationDto {
  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(20)
  search?: string;
}

export class RejectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}
