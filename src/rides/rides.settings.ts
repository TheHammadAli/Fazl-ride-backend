import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Matching knobs. The defaults follow the confirmed spec; override with env vars.
@Injectable()
export class RideSettings {
  // How long a passenger's request stays open.
  readonly requestTtlSeconds: number;
  // How long one driver has to answer an offer, and how often the search widens.
  readonly offerTtlSeconds: number;
  // Drivers offered per round.
  readonly offersPerRound: number;
  // Search radius per step, in metres; the last one is kept until the request expires.
  readonly radiiMeters: number[];
  // Sweeper period. Set MATCHING_SWEEPER=off to disable it (tests, extra instances).
  // How close (metres) the driver must be to the pickup to press "Arrived".
  readonly arrivalRadiusMeters: number;
  // A final fare is capped at this multiple of the estimate, so one GPS glitch
  // cannot turn a cash ride into a huge bill.
  readonly maxFareFactor: number;
  // How long after completion a ride can still be rated.
  readonly ratingWindowDays: number;
  readonly tickMs: number;
  readonly sweeperEnabled: boolean;

  constructor(config: ConfigService) {
    this.requestTtlSeconds = Number(
      config.get('RIDE_REQUEST_TTL_SECONDS') ?? 120,
    );
    this.offerTtlSeconds = Number(config.get('OFFER_TTL_SECONDS') ?? 30);
    this.offersPerRound = Number(config.get('OFFERS_PER_ROUND') ?? 5);
    this.radiiMeters = String(
      config.get('RIDE_SEARCH_RADII_METERS') ?? '3000,5000,8000',
    )
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => v > 0);
    this.arrivalRadiusMeters = Number(
      config.get('ARRIVAL_RADIUS_METERS') ?? 300,
    );
    this.maxFareFactor = Number(config.get('MAX_FARE_FACTOR') ?? 3);
    this.ratingWindowDays = Number(config.get('RATING_WINDOW_DAYS') ?? 7);
    this.tickMs = Number(config.get('MATCHING_TICK_MS') ?? 5000);
    this.sweeperEnabled =
      String(config.get('MATCHING_SWEEPER') ?? 'on') !== 'off';
  }
}
