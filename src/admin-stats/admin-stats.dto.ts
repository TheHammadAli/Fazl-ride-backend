import { IsDateString, IsIn, IsOptional } from 'class-validator';
import type { Period } from '../common/time.js';

export class DashboardQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'last_week', 'month', 'year', 'all'])
  period?: Period;
}

export class ReportsQueryDto {
  // Business-local calendar days, both included. Default: the last 30 days.
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
