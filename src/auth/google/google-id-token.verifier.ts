import type { KeyObject } from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GOOGLE_CERTS_URL,
  GoogleIdentity,
  parseGoogleCerts,
  tokenKeyId,
  verifyGoogleIdToken,
} from './google-id-token.js';

/** Checks the ID token the app got from "Continue with Google". */
export abstract class GoogleIdTokenVerifier {
  /** Who signed in. Throws 401 for a token that doesn't check out, 503 when
   *  Google sign-in isn't set up or Google's keys can't be had. */
  abstract verify(idToken: string): Promise<GoogleIdentity>;
}

/** Google's own keys, downloaded and kept as long as Google says they hold. */
@Injectable()
export class GoogleCertsVerifier extends GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleCertsVerifier.name);
  private keys = new Map<string, KeyObject>();
  private keysUntil = 0;
  private loadedAt = 0;
  private loading?: Promise<void>;

  constructor(private readonly config: ConfigService) {
    super();
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    // The OAuth client IDs tokens may be meant for (web, Android, iOS).
    const audiences = (this.config.get<string>('GOOGLE_CLIENT_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (audiences.length === 0) {
      throw new ServiceUnavailableException('Google sign-in is not set up yet');
    }
    const kid = tokenKeyId(idToken);
    if (!kid) throw this.failed();
    // A new key (Google rotates them), or the cached ones ran out — but at
    // most once a minute, so made-up key ids can't make us fetch on repeat.
    const stale = Date.now() > this.keysUntil;
    const unknown = !this.keys.has(kid) && Date.now() - this.loadedAt > 60_000;
    if (stale || unknown) await this.loadKeys();
    const who = verifyGoogleIdToken(idToken, this.keys, audiences);
    if (!who) throw this.failed();
    return who;
  }

  private failed() {
    return new UnauthorizedException('Google sign-in failed. Please try again.');
  }

  /** One download at a time, shared by every request waiting on it. */
  private async loadKeys() {
    this.loading ??= (async () => {
      try {
        const res = await fetch(GOOGLE_CERTS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.keys = parseGoogleCerts(await res.json());
        this.loadedAt = Date.now();
        const maxAge = /max-age=(\d+)/.exec(
          res.headers.get('cache-control') ?? '',
        );
        this.keysUntil =
          Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000;
      } catch (error) {
        this.logger.warn(`Google keys not loaded: ${String(error)}`);
        if (this.keys.size === 0) {
          throw new ServiceUnavailableException(
            "Couldn't reach Google. Please try again.",
          );
        }
        // Keep the keys we had for now; try again in a minute.
        this.keysUntil = Date.now() + 60_000;
      } finally {
        this.loading = undefined;
      }
    })();
    await this.loading;
  }
}
