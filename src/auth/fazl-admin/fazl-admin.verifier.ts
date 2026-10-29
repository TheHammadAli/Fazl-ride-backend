import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FazlStaff, parseFazlStaff } from './fazl-admin.js';

/** Checks a Fazl Admin panel login with the Fazl Admin backend. */
export abstract class FazlAdminVerifier {
  /** Whose login it is. Throws 401 for a login Fazl Admin doesn't accept
   *  (expired, signed out, not staff), 503 when it isn't set up or can't be
   *  reached. */
  abstract verify(token: string): Promise<FazlStaff>;
}

const TIMEOUT_MS = 10_000;

/**
 * Asks the Fazl Admin backend (FAZL_ADMIN_API_URL) who the token belongs to.
 * Asking, rather than checking the token's signature here, means no secret is
 * shared between the two backends, and a disabled account or a permission
 * taken away counts at once.
 */
@Injectable()
export class FazlAdminApiVerifier extends FazlAdminVerifier {
  private readonly logger = new Logger(FazlAdminApiVerifier.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  async verify(token: string): Promise<FazlStaff> {
    const base = (this.config.get<string>('FAZL_ADMIN_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (!base) {
      throw new ServiceUnavailableException(
        'Fazl Admin sign-in is not set up yet',
      );
    }

    let res: Response;
    try {
      res = await fetch(`${base}/admins/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Fazl Admin not reached: ${String(error)}`);
      throw this.unreachable();
    }
    // 403 / 404: a customer's or a Seller Central token, not a staff login.
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new UnauthorizedException('Your Fazl Admin login is not valid');
    }
    if (!res.ok) {
      this.logger.warn(`Fazl Admin answered GET /admins/me with ${res.status}`);
      throw this.unreachable();
    }
    const staff = parseFazlStaff(await res.json().catch(() => null));
    if (!staff) {
      this.logger.warn('Fazl Admin answered GET /admins/me with an unknown shape');
      throw this.unreachable();
    }
    return staff;
  }

  private unreachable() {
    return new ServiceUnavailableException(
      "Couldn't reach Fazl Admin. Please try again.",
    );
  }
}
