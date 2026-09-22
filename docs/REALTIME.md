# Realtime (Socket.IO) guide for the apps

REST stays the source of truth; sockets only **push** changes so the apps do not have to poll.
Every event carries the same objects the REST endpoints return, so one model class serves both.

## Connecting

- URL: the API host, namespace **`/realtime`** (for example `https://api.example.com/realtime`).
- Send the access token in the handshake: `auth: { token: '<accessToken>' }`.
- Use the websocket transport.
- On success the server emits **`connected`** `{ userId, serverTime }`.
- On failure it emits **`auth:error`** and closes the socket.
- Access tokens last 15 minutes. Shortly before or when the token runs out the server emits **`auth:expired`** and closes the socket:
  refresh the token (`POST /auth/refresh`) and reconnect with the new one.
- If the account is blocked or deleted the server emits **`auth:revoked`** and closes the socket. Do not reconnect; go to login.
- One person can be connected on several devices; each gets every event.

```dart
final socket = io.io('$host/realtime', io.OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})
    .disableAutoConnect()
    .build());
socket.onConnect((_) => resync());          // see "After (re)connecting"
socket.on('ride:update', (data) => ...);
socket.connect();
```

## After (re)connecting: resync over REST

Events sent while the app was offline are **not replayed**. On every `connected`:

- Passenger app: `GET /rides/active`.
- Driver app: `GET /drivers/me/active-ride` and `GET /drivers/me/offers`.

## Events the server sends

| Event | To | Payload | When |
|---|---|---|---|
| `ride:offer` | driver | offer object (same as items of `GET /drivers/me/offers`) | a ride is offered to this driver, or the passenger changed the price on a **negotiable** ride while this driver had not answered yet |
| `ride:offer_closed` | driver | `{ rideId, reason }` reason = `taken` \| `cancelled` \| `expired` | an offer disappeared; remove it from the list |
| `ride:bid` | passenger | `{ rideId, offerId, amount, isPending, etaSeconds, distanceToPickupMeters, driver }` (same shape as one item of `GET /rides/:id/bids`) | a driver answered a **negotiable** ride (their own price, or accepted the suggested one) |
| `ride:update` | passenger and driver of the ride | ride object (same as `GET /rides/:id`) | any status change: accepted, arrived, started, completed, cancelled, expired, or back to `requested` after the driver backed out |
| `driver:offline` | driver | `{ reason: "inactive", lastSeenAt }` | the server put this driver offline because no position arrived for 5 minutes; show it and offer "Go Online" |
| `driver:location` | passenger | `{ rideId, status, lat, lng, etaSeconds, distanceToPickupMeters }` | while a driver is on the way (`accepted`, ETA and distance filled) and during the trip (`started`, both `null`); at most every 1.5 s |

Each person only receives their own events. Phone numbers appear in `ride:update` only while the ride is `accepted`, `arrived` or `started`.

Offers expire after 30 seconds (`expiresAt` in the offer); drop them on the client when the time passes.
There is no event for that expiry.

## Events the app can send

| Event | From | Payload | Ack |
|---|---|---|---|
| `driver:location` | driver | `{ lat, lng, heading?, speedKmh? }` | `{ ok: true }` or `{ ok: false, error }` |

Errors: `unauthenticated`, `forbidden` (not a driver), `invalid_payload`, `too_fast` (more than one message per 500 ms), or the reason
the driver cannot send a position (for example "Go online before sending locations").
Send about every 4 seconds while online. `POST /drivers/me/location` still works and does exactly the same.

Everything else (go online/offline, request, accept, decline, arrived, start, complete, cancel, rate) stays on REST.

## Staying online (Driver app)

A driver who is online must keep sending a position. If none arrives for **5 minutes** the server sets the driver **offline**
(`driver:offline`, and `GET /drivers/me/status` then says `online: false`); the online time ends at the last position received.
After 60 seconds without a position the driver already stops receiving new offers, so a short tunnel or lift is harmless.
A driver who is on a ride is never put offline this way. To keep working in the background the app must keep sending
positions while the screen is off (Android foreground service and background location permission, asked when the driver first goes online).

## Limits to know about

- One API instance for now. To run several, add a Redis adapter for Socket.IO and move the domain event bus to Redis.
- The websocket does not use the HTTP rate limit; the location message has its own 500 ms limit per socket.
