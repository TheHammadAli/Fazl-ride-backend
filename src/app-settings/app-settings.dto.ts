import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// '' clears a field; anything else must be valid.
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class UpdateAppSettingsDto {
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(30)
  supportPhone?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(30)
  supportWhatsapp?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  supportEmail?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  supportHours?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  privacyUrl?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  termsUrl?: string | null;
}
