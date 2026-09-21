// One row in the History screen. Every module (rides, deliveries, parking, ...)
// describes its own records in this shape, so the feed never has to know them.
export interface ActivityItem {
  id: string;
  // Tab the row belongs to: 'ride' | 'delivery' | 'parking' | anything a new module adds.
  type: string;
  title: string;
  subtitle: string | null;
  occurredAt: Date;
  status: string;
  amount: { value: number; currency: string } | null;
  // Stars the current user gave for this activity, if it can be rated.
  myRating: number | null;
  // Where the app should go when the row is tapped.
  ref: { module: string; id: string };
}

export interface ActivityQuery {
  userId: string;
  // The user's phone number, for modules whose records are matched by phone.
  phone: string;
  // Rides can be listed from either side; other modules may ignore it.
  as: 'passenger' | 'driver';
  limit: number;
  // Only items strictly older than this (time, then id) are wanted.
  before: { at: Date; id: string } | null;
}

export abstract class ActivityProvider {
  abstract readonly type: string;
  // Newest first, at most `limit` items.
  abstract list(query: ActivityQuery): Promise<ActivityItem[]>;
}
