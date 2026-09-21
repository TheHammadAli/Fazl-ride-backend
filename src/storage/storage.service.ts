// All file storage goes through this class so the provider stays swappable
// (Supabase Storage now, possibly S3 later). Files are private; they are only
// ever exposed through short-lived signed URLs.
export abstract class StorageService {
  abstract upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void>;
  abstract remove(keys: string[]): Promise<void>;
  abstract createSignedUrl(
    key: string,
    expiresInSeconds: number,
  ): Promise<string>;
}
