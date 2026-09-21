// SMS provider is still undecided (Twilio is expensive in Pakistan).
// AuthModule binds this token to a concrete provider; swap it there.
export abstract class SmsProvider {
  abstract send(phone: string, message: string): Promise<void>;
}
