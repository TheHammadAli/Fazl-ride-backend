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

## Phases (single developer estimates)
0. Setup: NestJS + Prisma + local Postgres/PostGIS, `/health`, Swagger, `.env`, API contract (~3-4 days)
1. Foundation: OTP login, JWT, roles, profile, Become a Driver + vehicle/document upload to Supabase Storage, admin approval endpoints (~2 weeks)
2. **Parking first**: PostGIS nearby, list/details, register parking, owner availability update (~2-3 weeks). It is the smallest module and proves the pipeline
3. Ride: online/offline, GPS, request/accept, lifecycle `requested, accepted, arrived, started, completed/cancelled`, live tracking, ratings, history, notifications (~5-6 weeks)
4. FAZL integration: tracking API keyed by order id, status sync, configurable statuses, Track Order (~3 weeks). Needs FAZL's API docs. Not yet obtained
5. Testing and launch (~2-3 weeks)

## Mockup details that affect the backend
- Ride categories Economy / Comfort / XL with per-category fare (doc lists these as future scope; the design shows them)
- Wallet tab, in-app Message button and parking "Reserve" button appear in the design but are future in the doc. Plan: Reserve shown as "Coming soon"; Wallet and Chat later
- Driver Earnings shows a **Cashout** row (payouts). It is not in the doc; needs a decision
- Parking status has **Available / Limited / Full**; the "Limited" threshold is undecided
- Order Details shows a timestamp per status, so store status history
- Ride History has tabs All / Rides / Deliveries / Parking

## Open questions
- SMS/OTP provider; OTP only vs password; social login
- Fare rules (base, per-km, per-category) and admin configurability
- Cashout/payout behaviour; Limited threshold
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

## Not built yet
- Verified end to end on real Supabase (DB + Storage) on 2026-09-21: login, apply, upload/replace/list documents, signed URLs, admin detail and approve, refresh rotation. Note a replaced file's old signed URL can still work briefly because of Supabase's CDN cache, even though the object is deleted.
- Open: should approval require all documents to be uploaded? Currently it does not.
- Real SMS provider, FCM push, API-key auth for external systems
- Parking module (Phase 2), rides (Phase 3), FAZL integration (Phase 4)
