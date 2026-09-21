import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

// The pg driver treats `sslmode=require` as full certificate verification,
// which fails against Supabase because its CA is not in Node's trust store.
// When DATABASE_SSL_CA points at the CA file, sslmode is removed from the URL
// and the CA is passed explicitly, so the connection stays fully verified.
function poolConfig(config: ConfigService): PoolConfig {
  const connectionString = config.getOrThrow<string>('DATABASE_URL');
  const caPath = config.get<string>('DATABASE_SSL_CA');
  if (!caPath) return { connectionString };

  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: {
      ca: readFileSync(resolve(caPath), 'utf8'),
      rejectUnauthorized: true,
    },
  };
}

// Connects lazily on the first query, so the app can boot (and /health can
// report the database as down) even when Postgres is not reachable yet.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg(poolConfig(config)) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
