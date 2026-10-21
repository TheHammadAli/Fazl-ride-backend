// One notification for one person's phones. `data` travels with it so the app
// can open the right screen when it is tapped.
export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
  // Android channel the app created: "ride_requests" (loud, heads-up),
  // "sos" (alarm, for the safety team) or "general".
  channel: 'ride_requests' | 'sos' | 'general';
  // Drop it if it cannot be delivered in time (a ride offer is useless once
  // it has expired).
  ttlSeconds?: number;
  // Notifications with the same tag replace each other on the phone.
  tag?: string;
}

// Sends push notifications. Swap the binding in PushModule to use another
// service; nothing else knows which one is used.
export abstract class PushProvider {
  // Returns the tokens the service says are dead, so they can be forgotten.
  abstract send(
    tokens: string[],
    message: PushMessage,
  ): Promise<{ deadTokens: string[] }>;
}
