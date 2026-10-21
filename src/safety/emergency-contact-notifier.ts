import { Injectable, Logger } from '@nestjs/common';

export interface SosForContact {
  contactPhone: string;
  personName: string | null;
  lat: number;
  lng: number;
}

// Tells a person's emergency contact about their SOS (an SMS with where they
// are). Behind an adapter like the other providers: until an SMS provider is
// set up this only logs, and the app says so instead of claiming it was sent.
export abstract class EmergencyContactNotifier {
  // True when a provider is set up and the contact really gets a message.
  abstract readonly enabled: boolean;
  abstract notify(sos: SosForContact): Promise<void>;
}

@Injectable()
export class LoggingEmergencyContactNotifier extends EmergencyContactNotifier {
  private readonly logger = new Logger('EmergencyContactNotifier');
  readonly enabled = false;

  async notify(sos: SosForContact) {
    this.logger.warn(
      `SOS for ${sos.personName ?? 'a user'}: no SMS provider, contact not messaged`,
    );
  }
}
