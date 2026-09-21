import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
  at: Date;
}

// In-process event bus. A module announces what happened ("ride.accepted") and
// never knows who listens: sockets, push notifications and webhooks subscribe
// with `on(...)`, so new integrations do not touch the module that raised it.
@Injectable()
export class DomainEvents {
  private readonly subject = new Subject<DomainEvent>();

  emit<T>(type: string, payload: T) {
    this.subject.next({ type, payload, at: new Date() });
  }

  on<T = unknown>(...types: string[]): Observable<DomainEvent<T>> {
    return this.subject.pipe(
      filter((e) => types.length === 0 || types.includes(e.type)),
    ) as Observable<DomainEvent<T>>;
  }
}
