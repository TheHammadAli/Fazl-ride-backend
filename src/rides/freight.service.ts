import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { detectFileType } from '../common/file-type.js';
import { StorageService } from '../storage/storage.service.js';

export const MAX_LOAD_PHOTO_BYTES = 5 * 1024 * 1024;

// Freight: the photo of the goods a customer attaches to a booking. The
// booking itself is a ride (see RidesService.request) offered to every
// nearby driver of the chosen goods vehicle type.
@Injectable()
export class FreightService {
  private readonly logger = new Logger(FreightService.name);

  constructor(private readonly storage: StorageService) {}

  // Stored privately under the customer's own folder, so a booking can only
  // use a photo that customer uploaded (checked in RidesService).
  async uploadLoadPhoto(userId: string, file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A non-empty "file" is required');
    }
    const detected = detectFileType(file.buffer);
    if (!detected || detected.mime === 'application/pdf') {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP photos are allowed',
      );
    }
    const key = `freight/${userId}/${randomUUID()}.${detected.ext}`;
    await this.storage.upload(key, file.buffer, detected.mime);
    return { key, url: await this.signed(key) };
  }

  private async signed(key: string | null) {
    if (!key) return null;
    try {
      return await this.storage.createSignedUrl(key, 60 * 60);
    } catch (error) {
      this.logger.warn(`Could not sign ${key}: ${String(error)}`);
      return null;
    }
  }
}
