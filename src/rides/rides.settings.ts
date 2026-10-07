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

  // "bidding" (InDrive-style: broadcast to everyone, drivers propose a price,
  // the passenger chooses) or "fixed" (the original Uber/Careem style: nearest
  // few drivers, first to accept at the quoted price wins). Config, not code,
  // so the business can switch back without a release.
  readonly pricingMode: 'bidding' | 'fixed';
  // How far a negotiable request is broadcast, and to how many drivers at
  // once - effectively "everyone in the city" rather than "the nearest few".
  readonly negotiableRadiusMeters: number;
  readonly negotiableOffersLimit: number;
  // A negotiable price can be lowered, but not below this fraction of the
  // ride's fixed/estimated fare (raising it has no limit beyond the DTO's
  // plain Max(1_000_000)). 0.5 matches the app's own price-stepper floor.
  readonly negotiationMinFareFraction: number;
  // Freight: how far away drivers are asked, how long the whole request
  // stays open, and how long each driver has to answer (they read the load
  // details and look at the photo first, so longer than a ride's 30 s).
  readonly freightRadiusMeters: number;
  readonly freightRequestTtlSeconds: number;
  readonly freightOfferTtlSeconds: number;
  // The furthest a within_city trip can go (straight line); further is
  // between cities and must use city_to_city rates. Karachi is the widest
  // city at roughly 70 km across.
  readonly withinCityMaxMeters: number;

  constructor(config: ConfigService) {
    this.requestTtlSeconds = Number(
      config.get('RIDE_REQUEST_TTL_SECONDS') ?? 120,
    );
    this.offerTtlSeconds = Number(config.get('OFFER_TTL_SECONDS') ?? 30);
    this.freightRadiusMeters = Number(
      config.get('FREIGHT_RADIUS_METERS') ?? 25_000,
    );
    this.freightRequestTtlSeconds = Number(
      config.get('FREIGHT_REQUEST_TTL_SECONDS') ?? 600,
    );
    this.freightOfferTtlSeconds = Number(
      config.get('FREIGHT_OFFER_TTL_SECONDS') ?? 120,
    );
    this.withinCityMaxMeters = Number(
      config.get('WITHIN_CITY_MAX_METERS') ?? 75_000,
    );
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
    this.pricingMode =
      String(config.get('RIDE_PRICING_MODE') ?? 'bidding') === 'fixed'
        ? 'fixed'
        : 'bidding';
    this.negotiableRadiusMeters = Number(
      config.get('NEGOTIABLE_RADIUS_METERS') ?? 50_000,
    );
    this.negotiableOffersLimit = Number(
      config.get('NEGOTIABLE_OFFERS_LIMIT') ?? 300,
    );
    this.negotiationMinFareFraction = Number(
      config.get('NEGOTIABLE_MIN_FARE_FRACTION') ?? 0.5,
    );
  }
}
