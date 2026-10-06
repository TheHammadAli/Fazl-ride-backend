import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { detectFileType } from '../common/file-type.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { DriverApprovalService } from './driver-approval.service.js';
import { DriverIdentityService } from './driver-identity.service.js';
import { isVehicleDocument } from './driver-requirements.js';
import { UploadDocumentDto } from './dto/document.dto.js';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 10 * 60;

interface StoredDocument {
  id: string;
  type: string;
  vehicleId: string | null;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
}

@Injectable()
export class DriverDocumentsService {
  private readonly logger = new Logger(DriverDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly approval: DriverApprovalService,
    private readonly identity: DriverIdentityService,
  ) {}

  // Uploading the same type (and vehicle) again replaces the previous file.
  // An approved driver replacing a reviewed paper (a renewed licence, a new
  // CNIC) goes back to review, like a changed name or photo.
  async upload(
    userId: string,
    dto: UploadDocumentDto,
    file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A non-empty "file" is required');
    }
    const detected = detectFileType(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Only JPEG, PNG, WebP or PDF files are allowed',
      );
    }

    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicles: { select: { id: true } } },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    if (profile.status === 'suspended') {
      throw new ForbiddenException('Your driver account is suspended');
    }

    const isVehicleDoc = isVehicleDocument(dto.type);
    if (isVehicleDoc && !dto.vehicleId) {
      throw new BadRequestException(`vehicleId is required for ${dto.type}`);
    }
    if (!isVehicleDoc && dto.vehicleId) {
      throw new BadRequestException(
        'vehicleId is only allowed for vehicle documents',
      );
    }
    if (
      dto.vehicleId &&
      !profile.vehicles.some((v) => v.id === dto.vehicleId)
    ) {
      throw new NotFoundException('Vehicle not found');
    }

    // Only replacing something the admin already saw needs a new review;
    // adding a paper that became required later does not.
    const replacing =
      profile.status === 'approved' &&
      (await this.prisma.driverDocument.count({
        where: {
          driverProfileId: profile.id,
          type: dto.type,
          vehicleId: dto.vehicleId ?? null,
        },
      })) > 0;
    if (replacing) await this.identity.beforeChange(userId);

    const storageKey = `drivers/${profile.id}/${dto.type}-${randomUUID()}.${detected.ext}`;
    await this.storage.upload(storageKey, file.buffer, detected.mime);

    const scope = {
      driverProfileId: profile.id,
      type: dto.type,
      vehicleId: dto.vehicleId ?? null,
    };
    let replaced: { storageKey: string }[];
    let created;
    try {
      [replaced, created] = await this.prisma.$transaction(async (tx) => {
        const old = await tx.driverDocument.findMany({
          where: scope,
          select: { storageKey: true },
        });
        await tx.driverDocument.deleteMany({ where: scope });
        const doc = await tx.driverDocument.create({
          data: {
            ...scope,
            storageKey,
            mimeType: detected.mime,
            sizeBytes: file.size,
          },
        });
        return [old, doc] as const;
      });
    } catch (error) {
      await this.removeQuietly([storageKey]);
      throw error;
    }
    await this.removeQuietly(replaced.map((d) => d.storageKey));
    await this.identity.resolveIssues(userId, [
      { field: dto.type, vehicleId: dto.vehicleId },
    ]);
    if (replacing) {
      await this.identity.sendForReview(userId, [`document:${dto.type}`]);
    } else {
      // Opportunistic: while DEV_AUTO_APPROVE_DRIVERS=true, this may have
      // just satisfied the last missing requirement.
      await this.approval.maybeAutoApprove(profile.id);
    }
    return this.withUrl(created);
  }

  async listMine(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    return this.withUrls(profile.documents);
  }

  async withUrls(docs: StoredDocument[]) {
    return Promise.all(docs.map((doc) => this.withUrl(doc)));
  }

  // Deletes files that no database row points to any more. Failures are only
  // logged: an orphaned private file is harmless, a failed request is not.
  async removeQuietly(keys: string[]) {
    try {
      await this.storage.remove(keys);
    } catch (error) {
      this.logger.warn(
        `Could not delete ${keys.length} file(s): ${String(error)}`,
      );
    }
  }

  private async withUrl(doc: StoredDocument) {
    return {
      id: doc.id,
      type: doc.type,
      vehicleId: doc.vehicleId,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt,
      url: await this.storage.createSignedUrl(
        doc.storageKey,
        SIGNED_URL_SECONDS,
      ),
    };
  }
}
