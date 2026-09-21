import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider.js';

// Development only: prints the message instead of sending it.
@Injectable()
export class ConsoleSmsProvider extends SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  constructor() {
    super();
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        'ConsoleSmsProvider is active in production: OTP codes are written to the logs. Bind a real SMS provider.',
      );
    }
  }

  async send(phone: string, message: string) {
    this.logger.log(`SMS to ${phone}: ${message}`);
  }
}
