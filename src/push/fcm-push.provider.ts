import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PushProvider, type PushMessage } from './push.provider.js';

// Error codes meaning the token will never work again.
const DEAD = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

// Firebase Cloud Messaging. Needs the service account JSON of the Firebase
// project in FIREBASE_SERVICE_ACCOUNT (the file's contents, or the same
// base64-encoded). Without it nothing is sent and a warning is logged once.
@Injectable()
export class FcmPushProvider extends PushProvider {
  private readonly logger = new Logger(FcmPushProvider.name);
  private readonly app: App | null;

  constructor(config: ConfigService) {
    super();
    this.app = this.init(config.get<string>('FIREBASE_SERVICE_ACCOUNT'));
  }

  private init(raw?: string): App | null {
    if (!raw?.trim()) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT is not set: push is off');
      return null;
    }
    try {
      const text = raw.trim().startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf8');
      const account = JSON.parse(text);
      return (
        getApps().find((a) => a.name === 'fazl-push') ??
        initializeApp({ credential: cert(account) }, 'fazl-push')
      );
    } catch (error) {
      this.logger.error(
        `FIREBASE_SERVICE_ACCOUNT could not be read: ${String(error)}`,
      );
      return null;
    }
  }

  async send(tokens: string[], message: PushMessage) {
    if (!this.app || !tokens.length) return { deadTokens: [] };
    const result = await getMessaging(this.app).sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'high',
        ttl: message.ttlSeconds != null ? message.ttlSeconds * 1000 : undefined,
        notification: {
          channelId: message.channel,
          tag: message.tag,
          sound: 'default',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          ...(message.tag && { 'apns-collapse-id': message.tag }),
        },
        payload: { aps: { sound: 'default' } },
      },
    });
    const deadTokens: string[] = [];
    result.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (code && DEAD.has(code)) deadTokens.push(tokens[i]);
      else if (r.error) this.logger.warn(`Push failed: ${code}`);
    });
    return { deadTokens };
  }
}
