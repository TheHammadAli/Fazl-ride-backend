import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType } from '../generated/prisma/enums.js';

// What a driver must upload before an admin can approve. The business may
// change this, so it can be overridden with DRIVER_REQUIRED_DOCUMENTS
// (comma-separated DocumentType values). `vehicle_registration` is required
// once per vehicle, every other type once per driver.
export const DEFAULT_REQUIRED_DOCUMENTS: DocumentType[] = [
  'cnic_front',
  'cnic_back',
  'license_front',
  'selfie',
  'vehicle_registration',
];

export interface MissingDocument {
  type: DocumentType;
  vehicleId?: string;
}

export function parseRequiredDocuments(raw?: string): DocumentType[] {
  const values = (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!values.length) return DEFAULT_REQUIRED_DOCUMENTS;
  const valid = Object.values(DocumentType) as string[];
  const unknown = values.filter((v) => !valid.includes(v));
  if (unknown.length) {
    throw new Error(
      `DRIVER_REQUIRED_DOCUMENTS has unknown types: ${unknown.join(', ')}`,
    );
  }
  return values as DocumentType[];
}

export function findMissingDocuments(
  required: DocumentType[],
  vehicles: { id: string }[],
  documents: { type: DocumentType; vehicleId: string | null }[],
): MissingDocument[] {
  const missing: MissingDocument[] = required
    .filter((type) => type !== 'vehicle_registration')
    .filter((type) => !documents.some((d) => d.type === type))
    .map((type) => ({ type }));

  if (required.includes('vehicle_registration')) {
    for (const vehicle of vehicles) {
      const has = documents.some(
        (d) => d.type === 'vehicle_registration' && d.vehicleId === vehicle.id,
      );
      if (!has)
        missing.push({ type: 'vehicle_registration', vehicleId: vehicle.id });
    }
  }
  return missing;
}

@Injectable()
export class DriverRequirementsService {
  readonly required: DocumentType[];

  constructor(config: ConfigService) {
    this.required = parseRequiredDocuments(
      config.get<string>('DRIVER_REQUIRED_DOCUMENTS'),
    );
  }

  missing(
    vehicles: { id: string }[],
    documents: { type: DocumentType; vehicleId: string | null }[],
  ) {
    return findMissingDocuments(this.required, vehicles, documents);
  }
}
