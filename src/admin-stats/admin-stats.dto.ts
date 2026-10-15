import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class DashboardQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';
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
