import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { StorageService } from './storage.service.js';

// Uses Supabase only as object storage (not Auth / RLS). The service-role key
// stays on the server; clients never talk to Supabase directly.
@Injectable()
export class SupabaseStorageService extends StorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private client?: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    super();
  }

  async upload(key: string, body: Buffer, contentType: string) {
    const { error } = await this.bucket().upload(key, body, {
      contentType,
      upsert: false,
    });
    if (error) this.fail('upload', error);
  }

  async remove(keys: string[]) {
    if (!keys.length) return;
    const { error } = await this.bucket().remove(keys);
    if (error) this.fail('remove', error);
  }

  async createSignedUrl(key: string, expiresInSeconds: number) {
    const { data, error } = await this.bucket().createSignedUrl(
      key,
      expiresInSeconds,
    );
    if (error || !data) this.fail('sign', error);
    return data!.signedUrl;
  }

  private bucket() {
    if (!this.client) {
      const url = this.config.get<string>('SUPABASE_URL');
      const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key) {
        throw new ServiceUnavailableException('File storage is not configured');
      }
      this.client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client.storage.from(
      this.config.get<string>('SUPABASE_BUCKET') ?? 'driver-documents',
    );
  }

  private fail(action: string, error: unknown): never {
    this.logger.error(`Storage ${action} failed: ${JSON.stringify(error)}`);
    throw new BadGatewayException('File storage request failed');
  }
}
