import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DocumentType } from '../../generated/prisma/enums.js';

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type: DocumentType;

  // Required for vehicle_registration and vehicle_photo, not allowed otherwise.
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
