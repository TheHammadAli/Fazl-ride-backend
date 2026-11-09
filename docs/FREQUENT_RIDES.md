# Frequent rides

Frequent rides let an approved driver request access, publish a repeating route, and reserve seats for passengers travelling between stops on that route.

## Driver lifecycle

1. The driver's normal Fazl driver profile and at least one vehicle must already be approved.
2. `POST /api/v1/frequent-rides/application` submits a separate Frequent Rides application.
3. An admin lists pending requests with `GET /api/v1/admin/frequent-rides/applications` and reviews one with `PATCH /api/v1/admin/frequent-rides/applications/:id`, sending `{ "status": "approved" }` or `{ "status": "rejected", "reason": "..." }`.
4. After approval, the driver publishes a route with `POST /api/v1/frequent-rides/routes`. Stops are ordered origin to destination; days use Monday `1` through Sunday `7`; fare is the full route fare per passenger.
5. Drivers can pause/resume a route with `PATCH /api/v1/frequent-rides/routes/:id` and see passenger bookings with `GET /api/v1/frequent-rides/bookings/mine`.

## Passenger lifecycle

1. `GET /api/v1/frequent-rides/search` takes a travel date and pickup/drop-off coordinates. A match requires the nearest route stops to be within 3 km and to occur in route order.
2. The response includes stop positions, date-specific remaining seats, driver/vehicle details, and the segment fare.
3. `POST /api/v1/frequent-rides/routes/:id/book` takes date, pickup/drop-off stop positions, and seat count. The server calculates the fare and allocates seats under a route/date advisory lock so overlapping bookings cannot overbook a segment.
4. A passenger or the route's driver can cancel a booking with `DELETE /api/v1/frequent-rides/bookings/:id` before its travel date.

Segment fare is prorated from the driver's full-route fare by straight-line distance across the ordered route segments. This gives the initial release a deterministic fare without a new map-routing request for every search.

Apply the database change with the normal deployment migration process before enabling the feature:

```sh
npx prisma migrate deploy
```
