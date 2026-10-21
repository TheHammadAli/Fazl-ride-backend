import type { SupportPriority } from '../generated/prisma/enums.js';

// What a ticket can be about. Who may pick it (`for`), whether it needs a
// ride, whether it is about the other person on it, and how urgent it is by
// default (support can change the priority). Kept in code: the apps show
// the list they get from GET support/categories, so adding one here needs
// no app update.
export interface SupportCategory {
  key: string;
  label: string;
  for: ('passenger' | 'driver')[];
  needsRide: boolean;
  aboutOther: boolean;
  priority: SupportPriority;
}

export const SUPPORT_CATEGORIES: SupportCategory[] = [
  {
    key: 'safety',
    label: 'I felt unsafe / harassment',
    for: ['passenger', 'driver'],
    needsRide: true,
    aboutOther: true,
    priority: 'urgent',
  },
  {
    key: 'driver_behavior',
    label: 'Driver behaviour',
    for: ['passenger'],
    needsRide: true,
    aboutOther: true,
    priority: 'high',
  },
  {
    key: 'passenger_behavior',
    label: 'Passenger behaviour',
    for: ['driver'],
    needsRide: true,
    aboutOther: true,
    priority: 'high',
  },
  {
    key: 'lost_item',
    label: 'I lost an item',
    for: ['passenger'],
    needsRide: true,
    aboutOther: true,
    priority: 'high',
  },
  {
    key: 'overcharged',
    label: 'I was charged the wrong fare',
    for: ['passenger'],
    needsRide: true,
    aboutOther: false,
    priority: 'medium',
  },
  {
    key: 'payment_not_received',
    label: 'I was not paid for this trip',
    for: ['driver'],
    needsRide: true,
    aboutOther: true,
    priority: 'medium',
  },
  {
    key: 'route',
    label: 'Wrong or long route',
    for: ['passenger'],
    needsRide: true,
    aboutOther: true,
    priority: 'low',
  },
  {
    key: 'vehicle',
    label: 'Vehicle was not as shown / not clean',
    for: ['passenger'],
    needsRide: true,
    aboutOther: true,
    priority: 'low',
  },
  {
    key: 'wallet',
    label: 'Wallet or payment problem',
    for: ['passenger', 'driver'],
    needsRide: false,
    aboutOther: false,
    priority: 'medium',
  },
  {
    key: 'app_issue',
    label: 'Problem with the app',
    for: ['passenger', 'driver'],
    needsRide: false,
    aboutOther: false,
    priority: 'low',
  },
  {
    key: 'other',
    label: 'Something else',
    for: ['passenger', 'driver'],
    needsRide: false,
    aboutOther: false,
    priority: 'low',
  },
];

export const categoryByKey = (key: string) =>
  SUPPORT_CATEGORIES.find((c) => c.key === key);

// "#FZ-000123", how people and support refer to a ticket.
export const ticketCode = (n: number) => `FZ-${String(n).padStart(6, '0')}`;
