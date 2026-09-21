# Order tracking: integration guide for the FAZL APP backend

Our platform follows an order that FAZL APP already owns. **FAZL tells us what happens; we show it to the customer.**
Nothing here needs the customer to log in to our platform.

```
FAZL backend --(API key)--> our API : order, status, delivery person, live position
FAZL backend --(API key)--> our API : "give me a tracking token for this order"
FAZL app    -- opens our tracking screen with that token -->  customer sees status, rider, map, ETA
```

## 1. Access

Every call from FAZL carries an **API key** in the `x-api-key` header. Keys are created by our super admin
(`POST /admin/api-keys`) with the scopes `orders:write` (to send data) and `orders:read` (to read it back). Keep the key on FAZL's server only.

Base path: `/api/v1/integrations/orders`. All bodies are JSON. Coordinates are decimal degrees, times are ISO 8601 (UTC).
Every order is identified by **`source`** (default `"fazl"`) plus **your order id**. You never need our internal ids.

## 2. Create or update an order: `PUT /integrations/orders/{orderId}`

Call it whenever something changes, sending only what changed. Repeating a call is harmless.

```json
{
  "customerRef": "cust-77",
  "customerPhone": "03001112233",
  "pickup":   { "lat": 31.5104, "lng": 74.3436, "address": "FAZL Kitchen, Liberty" },
  "delivery": { "lat": 31.4697, "lng": 74.4106, "address": "House 12, DHA Phase 5" },
  "status": "driver_assigned",
  "statusAt": "2026-09-21T10:35:00Z",
  "note": "optional text kept on the timeline",
  "deliveryPerson": { "id": "rider-9", "name": "Ali Raza", "phone": "+923009998877",
                      "photoUrl": "https://.../ali.jpg", "rating": 4.8 },
  "vehicle": { "type": "car", "make": "Honda", "model": "Civic", "color": "Black", "plate": "LEA 5678" }
}
```

- A **new** order must include `delivery`. Everything else is optional.
- `status` is one of our status keys **or one of its aliases** (see below). Spaces, dashes and case do not matter (`In Transit` = `in-transit` = `IN_TRANSIT`). An unknown value returns `400` listing the valid ones.
- `statusAt` is when the step really happened (defaults to now; not more than 5 minutes in the future).
- `customerPhone` (any Pakistani format) lets the order appear under the customer's **Deliveries** in History. It is never shown to anyone.
- Once an order is `delivered` or `cancelled` it is closed: repeating the same status is fine, any change returns `409`.

## 3. Live position: `POST /integrations/orders/{orderId}/location`

Send it every 5 to 10 seconds while the rider moves.

```json
{ "lat": 31.49, "lng": 74.38, "heading": 90, "etaSeconds": 420, "at": "2026-09-21T11:05:10Z" }
```

`heading`, `etaSeconds` and `at` are optional. If you send `etaSeconds` we show it while the position is fresh (under 2 minutes);
otherwise we work out distance and ETA ourselves. After delivery, late positions are answered `200 {"accepted": false}`.

## 4. Let the customer track: `POST /integrations/orders/{orderId}/tracking-session`

Body (optional): `{ "ttlHours": 24 }` (1 to 168). Response:

```json
{ "token": "trk_...", "expiresAt": "2026-09-22T10:00:00.000Z", "orderId": "ORD-1001" }
```

FAZL APP opens our tracking screen and passes the token. The token opens **only this order**, expires by itself, and is shown once
(we keep only a hash). `POST .../tracking-session/revoke` cancels every link for the order at once.

Read back what the customer sees: `GET /integrations/orders/{orderId}` (scope `orders:read`).

## 5. Statuses

Default steps (from the requirements document), in order:
`order_confirmed`, `preparing`, `ready_for_pickup`, `driver_assigned`, `picked_up`, `in_transit`, `near_destination`, `delivered`, and `cancelled`.

Our admin can rename, reorder, add or switch off steps, and can add **aliases** so FAZL keeps using its own words
(for example alias `DISPATCHED` for `in_transit`). Tell us FAZL's status names and we map them once; you then just send them.

## 6. What the customer's app calls

- `GET /api/v1/tracking/order` with header `x-tracking-token: <token>` returns:
  `orderId`, `status {key,label,finished}`, `timeline [{key,label,reachedAt,done,current}]`, `pickup`, `delivery`,
  `deliveryPerson {name,photoUrl,rating,phone,vehicle}`, `location {lat,lng,heading,updatedAt}`, `etaSeconds`, `distanceRemainingMeters`, `deliveredAt`.
- **Live updates:** Socket.IO namespace **`/tracking`**, `auth: { token }`. The server sends `order:update` (the full object above, right after connecting
  and on every change) and `order:location` `{lat,lng,heading,etaSeconds,distanceRemainingMeters}` (at most every 1.5 s).
  It sends `auth:error` for a bad token, `auth:expired` when the link runs out and `auth:revoked` if it was cancelled, then closes the socket.

## 7. What is deliberately not shown

The customer's id, phone or any contact detail is never returned. The rider's phone is shown only while the order is on its way.
When the order is finished there is no live location, no ETA and no rider phone. Tokens are per order and hashed at rest.

## 8. Errors

`400` bad data (the message says which field) · `401` missing/invalid API key or tracking token · `403` key lacks the scope ·
`404` unknown order · `409` the order is already closed · `429` too many requests (very high limit for integrations).

## 9. Try it

```bash
curl -X PUT  "$HOST/api/v1/integrations/orders/ORD-1001" -H "x-api-key: $KEY" -H "content-type: application/json" \
     -d '{"customerPhone":"03001112233","delivery":{"lat":31.4697,"lng":74.4106,"address":"DHA Phase 5"}}'
curl -X POST "$HOST/api/v1/integrations/orders/ORD-1001/tracking-session" -H "x-api-key: $KEY" -H "content-type: application/json" -d '{}'
curl "$HOST/api/v1/tracking/order" -H "x-tracking-token: trk_..."
```

The full, always up to date list of fields is in Swagger at `/docs`.
