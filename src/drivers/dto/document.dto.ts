import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DocumentType } from '../../generated/prisma/enums.js';

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type: DocumentType;

  // Required for vehicle_registration, not allowed for the other types.
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
