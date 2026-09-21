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
  const header = req.headers?.authorization;
  if (
    typeof header === 'string' &&
    header.startsWith('Bearer ') &&
    header.length > 20
  ) {
    return `token:${createHash('sha256').update(header).digest('hex').slice(0, 32)}`;
  }
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
