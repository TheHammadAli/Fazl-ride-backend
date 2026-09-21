# FAZL Mobility Platform: Backend

Project context carried over from the planning session. Read this first.

## Working with the user
- Solo developer. Talks in Roman Urdu; reply in Roman Urdu, code and identifiers in English.
- Do not install system software, run `npm install`, or start big steps without asking first. The user twice interrupted tool calls before the roadmap was final.

## What we are building
One platform integrated with the existing **FAZL APP** with three modules:
1. **Ride booking**: Uber/Careem-style. Passenger books, driver accepts, live GPS tracking, ratings, history.
2. **FAZL order/delivery tracking**: a FAZL order can be tracked live (delivery person, vehicle, route, ETA, status timeline).
3. **Parking discovery**: map of nearby parking with total/available/occupied spaces, pricing, hours, navigation. Reservation/payment is a future phase.

Source spec: `FAZL Drivedocx.pdf` (34 sections, in `~/Documents/fazl`, next to the repos). Follow its Section 32: confirm flows, API, DB and business rules before building each module; anything outside agreed scope is a change request.

## Repos (only two)
- `fazl-parking-backend`: this repo, NestJS API.
- `fazl-parking-flutter`: one Flutter app (Passenger + Driver mode + Parking discovery + Parking Owner mode).
- The old `fazl-parking-frontned` repo is unused. FAZL already has its own admin panel; it will be integrated later. Do not build a new admin.

## Decisions made
| Area | Decision |
|---|---|
| Backend | NestJS + TypeScript |
| Database | PostgreSQL + PostGIS |
| ORM | Prisma **7.x** (npm `latest` is currently 8.0 RC; avoid RC) |
| Nearby queries | Prisma has no native PostGIS support, so use `$queryRaw` with PostGIS functions |
| Storage | **Supabase Storage for now** (user decision 2026-09-21, replaces AWS S3): one private bucket, files only reachable through short-lived signed URLs, service-role key server-side only. Everything goes through the abstract `StorageService`, so moving to S3 later means writing one class |
| Files | Never save files on the Render disk (ephemeral) |
| Hosting | Render (free tier only for testing; launch needs always-on paid) |
| Prod DB | Supabase Postgres (+PostGIS). Use it as Postgres and as object storage only. Do NOT use Supabase Auth/RLS. The user also wants Supabase as the dev database for now |
| Prisma + Supabase | Pooled URL for the app and a direct/session-pooler URL for migrations (`DATABASE_URL` and `DIRECT_URL`). Run `prisma migrate deploy` as the Render pre-deploy command |
| Dev DB | Local Postgres + PostGIS (planned via Homebrew; Docker is NOT installed and not required) |
| Redis | Not needed until the ride phase (live driver locations, OTP expiry, timeouts) |
| Realtime | Socket.IO gateway (ride phase) |
| Auth | Mobile number + OTP, JWT + refresh tokens. Social login and passwords are open questions |
| Roles | customer, driver, parking_operator, admin, super_admin. One `User` can hold several roles |
| Driver flow | Everyone registers as a passenger. "Become a Driver" then vehicle and documents, then admin approval, then a Passenger to Driver mode switch. Background GPS permission is requested only at first "Go Online" |
| Parking owner flow | Same pattern: "Register your parking", admin approval, then Parking Owner mode. Spaces are updated manually for v1 |
| External systems | Sensors, parking software and FAZL app call the API with **API keys**, a separate auth path from user JWT. Keep availability behind an adapter so automated sources can plug in later |
| Admin | No admin UI now. Build admin-role REST endpoints (approve driver/vehicle/parking, list rides, etc.), documented in Swagger. FAZL's existing admin will call them later; use Prisma Studio/Swagger meanwhile |
| Maps | Google Maps |
| Currency | PKR (mockups show $) |
| Payments | Cash only for now |

Other libs planned: Passport JWT, class-validator, Swagger, Throttler, BullMQ (later), Firebase Admin (FCM push), an SMS provider for OTP (undecided, Twilio is expensive in Pakistan).

## Design principle: integration-first (user requirement, 2026-09-21)
The platform must stay flexible so **any external system or new module can be integrated through the API**. Rules to follow when building anything:
1. **Modular monolith.** Each domain (auth/users, drivers, parking, rides, order-tracking, ...) is a self-contained Nest module: own controller, service, DTOs. Other modules use its exported service, never its Prisma tables. Adding a module = adding a folder and one import in `AppModule`.
2. **Two ways in, one set of rules.** User apps use JWT (roles). External systems (FAZL app, parking sensors/software, partners) use **API keys with scopes** (e.g. `parking:write`, `orders:read`), hashed at rest, revocable, with `lastUsedAt` and per-key rate limits. Admin endpoints create/revoke keys. A guard accepts either a JWT or an API key on the routes meant for both.
3. **Provider adapters for everything external.** Storage (`StorageService`), SMS (`SmsProvider`) already work this way. Parking availability (manual now, sensors later) and FAZL order status will too. New integration = new adapter class, no change to business logic.
4. **Stable, documented contract.** Versioned (`/api/v1`), Swagger/OpenAPI is the source of truth (partners can generate clients from `/docs-json`), consistent pagination and error shape, `Idempotency-Key` on external POSTs that create things.
5. **Events out.** Important state changes (driver approved, parking availability changed, order status changed) should be emitted as domain events so outbound webhooks or push notifications can subscribe without touching the module that raised them.
6. **Config over code.** Statuses, thresholds (e.g. parking "Limited"), fare rules, required documents live in config/DB where the business is likely to change them.

## Ride module spec (confirmed by the user 2026-09-21, defaults noted)
- **Fare:** per category (economy/comfort/xl): base + per-km + per-minute, with a minimum fare and a cancellation fee, all in PKR whole rupees, stored in `fare_configs` and editable through admin endpoints. Seeded values are placeholders the business must set. Cash only. Final fare is computed at completion from the distance actually driven and the real duration.
- **Matching:** on request, offer the ride to the nearest N (default 5) online, approved drivers of the requested category within a radius (default 3 km); the first to accept wins (atomic update on the ride). If nobody accepts, the radius grows on a timer; the request expires after ~2 minutes.
- **Lifecycle:** `requested -> accepted -> arrived -> started -> completed`, or `cancelled` / `expired`. One active ride per passenger and per driver. Passenger cancelling after a grace period (default 120 s from accept) or after the driver arrived pays the category's cancellation fee (recorded, collected manually since cash).
- **Realtime:** Socket.IO gateway (JWT in the handshake) for offers, ride updates and driver location; every action also exists as REST so the app can poll. Live driver locations sit in Postgres/PostGIS behind a `DriverLocationStore` adapter; Redis can replace it later without touching ride logic.
- **Routing/ETA:** behind a `RoutingProvider` adapter. Now a straight-line estimate with a detour factor; swap in Google Directions when a key exists.
- **Ratings:** both directions, 1-5 stars + optional comment, one per rater per ride.
- Sub-milestones: B1 fares + estimate, B2 driver presence + nearby, B3 request/offers/accept + expiry sweeper, B4 lifecycle + fare calculation + distance tracking, B5 ratings + history + admin rides, B6 Socket.IO, B7 push (FCM).

## Phases (single developer estimates)
0. Setup: NestJS + Prisma + local Postgres/PostGIS, `/health`, Swagger, `.env`, API contract (~3-4 days)
1. Foundation: OTP login, JWT, roles, profile, Become a Driver + vehicle/document upload to Supabase Storage, admin approval endpoints (~2 weeks)
2. **Parking first**: PostGIS nearby, list/details, register parking, owner availability update (~2-3 weeks). It is the smallest module and proves the pipeline
3. Ride: online/offline, GPS, request/accept, lifecycle `requested, accepted, arrived, started, completed/cancelled`, live tracking, ratings, history, notifications (~5-6 weeks)
4. FAZL integration: tracking API keyed by order id, status sync, configurable statuses, Track Order (~3 weeks). Needs FAZL's API docs. Not yet obtained
5. Testing and launch (~2-3 weeks)

## Mockup details that affect the backend
Source: the combined design image the user shared (Passenger app, Driver app, FAZL Order Tracking, Parking Discovery). Header text "One App. Multiple Services", tabs Ride | Deliver | Park, and a "More Services Coming Soon" panel: **more services will be added later**, which is why the platform must stay modular and integration-first. Prices in the mockup are in $ (we use PKR).

**Passenger app**
- Login screen shows mobile number **+ password**, "Forgot password?", Google / Apple / one more social icon, "Sign Up". Driver login shows mobile number + "Continue" (OTP style), Google/Apple, "Register". Our backend is OTP-only today. See open questions.
- Home: search "Where are you going?", nearby cars on the map, service tiles Ride / Delivery / Parking, and a "Track Your Order" banner (FAZL order).
- Choose a Ride: per category **pickup ETA + distance + fare** (Economy 4 min 2.3 km, Comfort 6 min 3.1 km, XL 8 min 4.2 km). So the estimate must also return the nearest driver's ETA and availability per category (planned in B2).
- Driver Arriving: driver card (name, rating with count, car make/model/colour, plate, photo), Call and Message buttons, "Arriving in 3 min", distance, live route. Needs a public driver card, live location and ETA. Call = expose the number or a masked call; Message = in-app chat (future).
- Ride Completed: total fare, rate the driver (stars), Submit, "View Ride Details".
- Ride History: tabs **All / Rides / Deliveries / Parking**, each row has route, date/time, fare, rating. Bottom nav: Home, Orders, Wallet, Profile. History must be a unified feed that every module can contribute to (design an `ActivityItem` contract, do not hard-wire rides).

**Driver app**
- Dashboard: Online toggle, "Go Online", **Today's Rides** and **Earnings**.
- Ride request card: pickup, drop-off, distance and time to pickup (2.5 km, 6 min), fare, Decline / Accept. The offer payload needs the client's address strings, distance/ETA to pickup and the amount shown to the driver.
- Navigation to pickup is turn-by-turn in the app (Google Maps on the client); the backend only needs status changes.
- Active Ride: passenger name and rating, route, vehicle, Call, Message, **Start Ride**.
- Earnings: period filter (Today), total, **Rides count, Online Hours**, Recent Transactions (Ride Fare +, **Cashout -**). Needs a per-driver earnings ledger and online-session tracking. Note: with cash-only rides the driver already holds the money, so "Cashout" only makes sense with a wallet/online payments or a commission settlement. Needs a decision.

**FAZL Order Tracking (screens live inside the FAZL app)**
- My Orders (Active / Completed) with order id like `#ORD123456`, date and status; Track Order map with "Driver is on the way", ETA and distance; Order Details with a status timeline and a **timestamp per step** (Order Confirmed, Preparing, Driver Assigned, In Transit, Delivered); Driver Details (name, rating, vehicle, plate, Call, Message, live location). The delivery person drives a car, so it can reuse the driver and vehicle model.

**Parking Discovery**
- Map with search nearby and pins; list card "Parking A, 2.1 km, 100 total, 27 available".
- Details: photo, name/area, Total / Available / Occupied, price per hour, operating hours, **Navigate**, **Reserve** (future, show "Coming soon").
- Availability list statuses **Available / Limited / Full**. From the mockup: 27/100 Available, 12/60 (20%) Available, 5/50 (10%) **Limited**, 0/80 Full. So the Limited threshold sits between 10% and 20%; proposed default **available <= 15% of total = Limited**, kept in config. Full = 0 available.

## Decisions from the design review (2026-09-21)
- **Login:** mobile OTP stays the identity (required for drivers). No password. Google/Apple sign-in is added later as an extra way to log in; if Google is offered, Apple must be too (App Store rule). The Password field and "Forgot password" in the mockup are dropped.
- **Earnings:** no platform commission for now. A driver's earnings are the full fare, kept in a ledger for display only; the mockup's "Cashout" row stays hidden until wallet/online payments exist. Commission % and payouts are a later phase.
- Parking "Limited" = available <= 15% of total (config).

## Open questions
- SMS/OTP provider (still open)
- Fare rules (base, per-km, per-category) and admin configurability
- Cashout/payout behaviour and platform commission (see the earnings note above)
- FAZL: API docs, whether FAZL users log in with the same account (SSO), and how Track Order opens our screens
- Whether the FAZL admin has its own backend/auth to reconcile with

## Current repo state (updated 2026-09-21)
- Git repo still has no commits, remote `git@github.com:awais002288/fazl-parking-backend.git`. Nothing committed yet; ask before committing.
- Kept the `nest new` scaffold (Nest 12, ESM, vitest, oxlint). `npm install` only works with `legacy-peer-deps=true` (in `.npmrc`) because of an npm arborist bug around vitest.
- Prisma 7.10.0 (`prisma-client` generator into `src/generated/prisma`, gitignored, regenerated on `postinstall`/`prebuild`), `@prisma/adapter-pg`. DB url lives in `prisma.config.ts` (uses `DIRECT_URL`), the app uses `DATABASE_URL`. `.env` exists locally (gitignored); `.env.example` is committed-safe.
- **Local Postgres 17** (fallback dev DB) installed via Homebrew (`postgresql@17`, keg-only, binaries in `/usr/local/opt/postgresql@17/bin`). Not a login service; start it with `LC_ALL="en_US.UTF-8" /usr/local/opt/postgresql@17/bin/pg_ctl -D /usr/local/var/postgresql@17 -l /usr/local/var/postgresql@17/server.log start` (without `LC_ALL` it dies with "postmaster became multithreaded"). Local user `mc`, no password; db `fazl`; `.env` URL is `postgresql://mc@localhost:5432/fazl`.
- Migration `20260921050318_init` is created and applied. Use `npm run prisma:migrate -- --name <x>` for schema changes.
- **PostGIS is NOT installed.** `brew install postgis` compiles ~130 dependencies from source on this Intel/macOS 15 Mac (no bottles), which takes hours. It is only needed from the Parking phase. Options then: find a prebuilt PostGIS (e.g. Postgres.app), or use Supabase's hosted PostGIS for dev. Ask the user.
- The API boots even without a DB (`/health` reports `database: down`).
- Machine: Node 22, npm 10, Flutter 3.47, Homebrew. Docker not installed.
- **Supabase is connected (2026-09-21).** Project `vnbuaxojzeucysivdkwd` (Singapore, Free plan: pauses after ~1 week idle). `.env` points `DATABASE_URL` (transaction pooler, 6543) and `DIRECT_URL` (session pooler, 5432) at `aws-0-ap-southeast-1.pooler.supabase.com`, user `postgres.<ref>`. The DB password contains `@`, so it is percent-encoded (`%40`) in `.env`. Do not use the `db.<ref>.supabase.co` direct host (IPv6-only). Local Postgres lines are kept commented in `.env` to switch back. Migrations `init` and `add_driver_documents` are applied on Supabase; all tables have RLS on (auto-RLS was enabled and the Data API was left off, since the app only uses Prisma/Postgres and Storage).
- **TLS to Supabase:** its CA is not in Node's trust store, so `pg` rejects `sslmode=require`. `DATABASE_SSL_CA=certs/supabase-ca-2021.crt` (public root cert, fingerprint checked against the live server) makes `PrismaService` pass the CA explicitly with full verification. Prisma CLI (migrate) works with plain `sslmode=require`. Unset `DATABASE_SSL_CA` for local Postgres.
- Storage: private bucket `driver-documents` on the same project; key in `.env` as `SUPABASE_SERVICE_ROLE_KEY` (an `sb_secret_...` key). The user pasted it in chat once, so rotate it (and the DB password, part of which was echoed in a tool output) before launch. Publishable key / JWKS are not used (no Supabase Auth).

## Built so far (customer + driver foundation)
All routes are under `/api/v1`, Swagger at `/docs`.
- `auth`: `POST auth/otp/request`, `auth/otp/verify` (first verify registers the user as `customer`), `auth/refresh` (rotating refresh tokens, replay of a revoked token revokes all), `auth/logout`. OTP is HMAC-hashed, 5 min TTL, 60 s resend gap, 5 attempts. SMS goes through the abstract `SmsProvider`; only `ConsoleSmsProvider` exists (prints the OTP in the server log). Phones are normalized to `+923XXXXXXXXX`.
- `users`: `GET/PATCH users/me` (returns roles and driver application status).
- `drivers`: `POST drivers/apply` (cnic + license + first vehicle, re-apply allowed after rejection), `GET drivers/me`, `POST drivers/me/vehicles` (approved drivers only).
- `admin` (role admin/super_admin): list users, list/get drivers, approve/reject driver (approve grants the `driver` role, reject removes it), approve/reject vehicle.
- Documents: `POST drivers/me/documents` (multipart `file` + `type` [+ `vehicleId` for `vehicle_registration`]; JPEG/PNG/WebP/PDF by magic bytes, max 5 MB; same type again replaces the old file), `GET drivers/me/documents`. Admin `GET admin/drivers/:id` returns documents with 10-minute signed URLs. Approve/reject never call storage. Re-applying after a rejection deletes the old vehicles' registration files.
- Roles are read from the DB on each request (JwtStrategy), so approval/block is immediate.
- First super admin: put the phone in `SUPER_ADMIN_PHONES` (env); it gets `super_admin` on its next OTP login.
- Gotcha: `@nestjs/passport` 12 with Nest 12 fails to resolve `AuthModuleOptions` in `JwtAuthGuard` unless `PassportModule.register(...)` is used (done in `AuthModule`, exported to feature modules).
- Tests: `npm test` (phone normalizer), `npm run test:e2e` (validation + 401 guards, no DB needed). The full flow (OTP, apply, duplicate CNIC/plate, approve/reject, re-apply, refresh rotation and replay, admin routes) was verified by hand against the local DB on 2026-09-21; that script is not in the repo. Prisma 7 + pg adapter puts the violated constraint name in `error.meta.driverAdapterError.cause.constraint.index`.
- Auth throttle: `otp/request` is limited to 5/min per IP, so scripted tests need pauses.

- **Accounts milestone (2026-09-21, all verified on real Supabase):**
  - Approval requires documents: default `cnic_front, cnic_back, license_front, selfie` + `vehicle_registration` per vehicle, overridable with `DRIVER_REQUIRED_DOCUMENTS`. `GET drivers/me` returns `missingDocuments`; admin approve of a driver or vehicle returns 400 with the missing list.
  - Admin: `POST admin/users/:id/block|unblock` (blocking revokes refresh tokens; only super_admin can block an admin; cannot block yourself), `POST admin/drivers/:id/suspend|reinstate`. Every admin action writes an `AuditLog` row.
  - Users: `POST/DELETE users/me/avatar` (JPEG/PNG/WebP, 2 MB, returned as a signed `avatarUrl`), `DELETE users/me` (account deletion required by the stores: anonymises the row, erases driver profile/documents/avatar, frees the phone; admins cannot self-delete). `JwtStrategy` accepts only `status = active`.
  - Drivers: `DELETE drivers/me/vehicles/:id` (never the only vehicle).
  - **API keys** for external systems: `POST/GET admin/api-keys`, `POST admin/api-keys/:id/revoke` (super_admin only). Key format `fzl_<8hex>_<secret>`, shown once, only a SHA-256 hash stored, scopes like `parking:write` / `orders:*` / `*`, optional expiry. Protect integration routes with `@UseGuards(ApiKeyGuard)` + `@Scopes('x:read')` and header `x-api-key`; import `ApiKeysModule`. `GET integrations/ping` (scope `ping:read`) is the reference route.
- **Migrations now run straight against Supabase**: `npx prisma migrate dev --name x` (uses `SHADOW_DATABASE_URL`, the scratch database `fazl_shadow` created on Supabase once). Local Postgres has no PostGIS and is no longer used for migrations; treat Supabase as the dev DB. **PostGIS 3.3 is enabled** (migration `enable_postgis`, schema `extensions`, on the default search_path so `ST_*` works through the pooler). Geography columns are declared as `Unsupported("geography(Point,4326)")` in the Prisma schema and queried with `$queryRaw`.
- Agreed build order (user): accounts (done) -> **ride booking** -> parking -> order tracking (FAZL integration). Ride business rules must be confirmed with the user before coding (Section 32): fare rules, cancellation, matching, timeouts, categories, commission, cashout.

- **Ride B1 done (2026-09-21):** `POST rides/estimate` (JWT; pickup/dropoff -> distance, ETA and fare for every category, rejects <50 m and >200 km), admin `GET admin/fares` and `PUT admin/fares/:category` (partial update, audited). Fares are seeded with placeholder PKR rates (economy 100 + 30/km + 3/min, min 150; comfort 150/40/4/220; xl 200/55/5/300). `RoutingProvider` adapter bound to a straight-line estimate (x1.35 detour, 25 km/h) in `RidesModule`; swap it for Google Directions later. Gotcha found by testing: `@ValidateNested()` alone lets a missing nested object through (500), so add `@IsDefined()` (covered by `nested-validation.spec.ts`).

- **Ride B2 done (2026-09-21):** driver presence. `POST drivers/me/online` (lat/lng, optional `vehicleId`, defaults to the first approved vehicle; needs the `driver` role), `POST drivers/me/offline` (409 while `busy`), `POST drivers/me/location` (lat/lng, heading, speedKmh), `GET drivers/me/status` (online, busy, vehicle, `onlineSecondsToday`). State lives in `driver_presence` (PostGIS `geography(Point,4326)` + GiST index) behind the `DriverLocationStore` adapter (`PostgisDriverLocationStore`; PostGIS points are lng,lat). A driver counts as nearby only if online, not busy and the last position is <= `DRIVER_LOCATION_TTL_SECONDS` (default 60) old. `driver_sessions` records online stretches; "today" uses `BUSINESS_TZ_OFFSET_MINUTES` (default 300 = Pakistan). `POST rides/estimate` now also returns, per category, `nearbyDrivers` (within 5 km), `pickupEtaSeconds` and `pickupDistanceMeters` of the nearest driver. The `busy` flag is set by the ride flow in B3/B4.

## Not built yet
- Verified end to end on real Supabase (DB + Storage) on 2026-09-21: login, apply, upload/replace/list documents, signed URLs, admin detail and approve, refresh rotation. Note a replaced file's old signed URL can still work briefly because of Supabase's CDN cache, even though the object is deleted.
- Real SMS provider, FCM push, API-key auth for external systems
- Parking module (Phase 2), rides (Phase 3), FAZL integration (Phase 4)
