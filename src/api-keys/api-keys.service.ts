import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateApiKeyDto } from './dto/api-key.dto.js';

const LAST_USED_REFRESH_MS = 60_000;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // The plain key is returned here once and never stored, only its hash is.
  async create(dto: CreateApiKeyDto, actorId: string) {
    const prefix = `fzl_${randomBytes(4).toString('hex')}`;
    const key = `${prefix}_${randomBytes(24).toString('base64url')}`;
    const record = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        prefix,
        keyHash: this.hash(key),
        scopes: dto.scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: actorId,
      },
    });
    await this.audit.log(actorId, 'api_key.create', 'api_key', record.id, {
      name: dto.name,
      scopes: dto.scopes,
    });
    return { ...this.present(record), key };
  }

  async list() {
    const keys = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => this.present(k));
  }

  async revoke(id: string, actorId: string) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API key not found');
    const record = existing.revokedAt
      ? existing
      : await this.prisma.apiKey.update({
          where: { id },
          data: { revokedAt: new Date() },
        });
    if (!existing.revokedAt) {
      await this.audit.log(actorId, 'api_key.revoke', 'api_key', id);
    }
    return this.present(record);
  }

  // Returns the key record if the raw key is valid, otherwise null.
  async validate(rawKey: string) {
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: this.hash(rawKey) },
    });
    if (!record || record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    const stale =
      !record.lastUsedAt ||
      Date.now() - record.lastUsedAt.getTime() > LAST_USED_REFRESH_MS;
    if (stale) {
      // Best effort and off the request path: not worth failing a call over.
      void this.prisma.apiKey
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return record;
  }

  private present(k: {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
