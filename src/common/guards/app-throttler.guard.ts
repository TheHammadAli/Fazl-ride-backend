import { createHash } from 'node:crypto';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Who a request counts against. Signed-in requests are counted per session, not
// per IP: many phones share one address behind a mobile carrier, so an IP limit
// would let one busy neighbour lock out everyone else. Requests without a token
// (login, OTP) are still counted per IP.
export function trackerFor(req: {
  headers?: Record<string, unknown>;
  ip?: string;
}): string {
  const headers = req.headers ?? {};
  const short = (value: string) =>
    createHash('sha256').update(value).digest('hex').slice(0, 32);

  const bearer = headers.authorization;
  if (
    typeof bearer === 'string' &&
    bearer.startsWith('Bearer ') &&
    bearer.length > 20
  ) {
    return `token:${short(bearer)}`;
  }
  // An integration (FAZL's server) counts as itself, not as one shared IP address.
  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 8)
    return `apikey:${short(apiKey)}`;
  // A customer watching one order counts per tracking link.
  const tracking = headers['x-tracking-token'];
  if (typeof tracking === 'string' && tracking.length > 8)
    return `track:${short(tracking)}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // This limit is for HTTP requests. Socket messages have their own per-socket
  // limit in the gateway, and running the HTTP logic on them would crash.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return trackerFor(req);
  }
}
