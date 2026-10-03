import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType } from '../generated/prisma/enums.js';

// What a driver must upload before an admin can approve. The business may
// change this, so it can be overridden with DRIVER_REQUIRED_DOCUMENTS
// (comma-separated DocumentType values). Vehicle documents are required
// once per vehicle, every other type once per driver.
export const DEFAULT_REQUIRED_DOCUMENTS: DocumentType[] = [
  'cnic_front',
  'cnic_back',
  'license_front',
  'license_back',
  'selfie',
  'vehicle_registration',
  'vehicle_photo',
];

export const VEHICLE_DOCUMENT_TYPES: DocumentType[] = [
  'vehicle_registration',
  'vehicle_photo',
];

export const isVehicleDocument = (type: DocumentType) =>
  VEHICLE_DOCUMENT_TYPES.includes(type);

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
    .filter((type) => !isVehicleDocument(type))
    .filter((type) => !documents.some((d) => d.type === type))
    .map((type) => ({ type }));

  for (const type of required.filter(isVehicleDocument)) {
    for (const vehicle of vehicles) {
      const has = documents.some(
        (d) => d.type === type && d.vehicleId === vehicle.id,
      );
      if (!has) missing.push({ type, vehicleId: vehicle.id });
    }
  }
  return missing;
}

export const MIN_DRIVER_AGE = 18;

// Shape checks only: they stop typos and junk ("abc", "123"). Whether the
// values are real is decided by the admin against the uploaded CNIC,
// licence and registration photos.

// At least a first and last name, letters only (dots/apostrophes/hyphens
// allowed inside, e.g. "M. Ali", "D'Souza").
export function isFullName(value: string) {
  const words = value.trim().split(/\s+/);
  return (
    value.trim().length <= 80 &&
    words.length >= 2 &&
    words.every((w) => /^[\p{L}][\p{L}.'-]*$/u.test(w)) &&
    words.filter((w) => w.replace(/[.'-]/g, '').length >= 2).length >= 2
  );
}

// "lea 1234" -> "LEA-1234", "leb 15  1234" -> "LEB-15-1234".
export function normalizePlate(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '-');
}

// Pakistani plates: a letters block (LEA, BFG, ICT-AB), an optional
// two-digit year, then 1-4 digits: LEA-1234, LEB-15-1234, ICT-AB-123.
export const PLATE_REGEX = /^[A-Z]{1,4}(-[A-Z]{1,3})?(-\d{2}-|-?)\d{1,4}$/;

// Formats differ by province (Punjab uses the CNIC number); require a real
// looking number: 5-20 letters/digits/-/ with at least four digits.
export function isLicenseNumber(value: string) {
  const v = value.trim();
  return /^[A-Za-z0-9/-]{5,20}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 4;
}

// What a driver's own profile still needs before they may be approved or go
// online. Name and photo live on the user (the passenger sees both on the
// ride card); the rest on the driver profile.
export type MissingProfileField =
  | 'name'
  | 'avatar'
  | 'dateOfBirth'
  | 'licenseExpiry'
  | 'licenseExpired'
  | 'emergencyContact';

export function findMissingProfile(
  user: { name: string | null; avatarKey: string | null },
  profile: {
    dateOfBirth: Date | null;
    licenseExpiry: Date | null;
    emergencyContact: string | null;
  },
  now = new Date(),
): MissingProfileField[] {
  const missing: MissingProfileField[] = [];
  if (!user.name?.trim()) missing.push('name');
  if (!user.avatarKey) missing.push('avatar');
  if (!profile.dateOfBirth) missing.push('dateOfBirth');
  if (!profile.licenseExpiry) missing.push('licenseExpiry');
  else if (isExpired(profile.licenseExpiry, now))
    missing.push('licenseExpired');
  if (!profile.emergencyContact) missing.push('emergencyContact');
  return missing;
}

// Dates are calendar days (@db.Date, midnight UTC), compared as such.
function utcDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isExpired(expiry: Date, now = new Date()) {
  return utcDay(expiry) < utcDay(now);
}

export function ageOn(dateOfBirth: Date, now = new Date()) {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
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
