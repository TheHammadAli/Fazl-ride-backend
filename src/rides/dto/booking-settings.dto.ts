import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Every field optional: only what is sent changes. Minutes unless named.
export class UpdateBookingSettingsDto {
  @IsOptional() @IsInt() @Min(10) @Max(24 * 60) minAheadMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) maxAheadDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxPerPassenger?: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) reservationRadiusKm?: number;

  @IsOptional() @IsInt() @Min(0) @Max(24 * 60) rideStartBefore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24 * 60) rideStartAfter?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24 * 60) freightStartBefore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24 * 60) freightStartAfter?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24 * 60) intercityStartBefore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24 * 60) intercityStartAfter?: number;

  @IsOptional() @IsInt() @Min(1) @Max(48 * 60) rideWarnFirst?: number;
  @IsOptional() @IsInt() @Min(1) @Max(48 * 60) rideWarnSecond?: number;
  @IsOptional() @IsInt() @Min(1) @Max(48 * 60) freightWarnFirst?: number;
  @IsOptional() @IsInt() @Min(1) @Max(48 * 60) freightWarnSecond?: number;
  @IsOptional() @IsInt() @Min(1) @Max(48 * 60) intercityWarnFirst?: number;
  @IsOptional() @IsInt() @Min(1) @Max(48 * 60) intercityWarnSecond?: number;

  @IsOptional() @IsInt() @Min(5) @Max(24 * 60) reminderMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) startNudgeMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) eveningReminderHour?: number;

  @IsOptional() @IsInt() @Min(0) @Max(48 * 60) lateReleaseMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) noShowLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) noShowWindowDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) noShowBlockDays?: number;
}
