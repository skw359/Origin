# Origin

A reverse geocoding API built on an OpenStreetMap database in PostgreSQL/PostGIS. Given a latitude and longitude, it answers with the city, the named place or building at that point, the nearest road, and the state, county and country. A click-to-identify endpoint also returns a building's address and footprint geometry, ready to outline on a map.

The server is a single Express application. It ships with a React dashboard for trying queries in the browser and a token-protected admin panel with live request statistics and a server log.

<img width="1280" height="655" alt="ihuhiuoihu" src="https://github.com/user-attachments/assets/76479f6d-0e4e-4744-8258-81427b1500b0" />


## Features

- City, place, building, road and full-context lookups, over GET or POST
- Batch endpoints for up to 100 points per request
- Building lookups with footprint GeoJSON and composed street addresses
- In-process LRU caching of results, keyed to roughly 11 m
- Admin panel with live requests per second, usage history and a streaming server console
- No external services: everything is answered from your own database

## Requirements

- Node.js 20.12 or newer
- PostgreSQL with the PostGIS and hstore extensions
- An OpenStreetMap extract imported with osm2pgsql

## Database setup

The server reads the `planet_osm_point`, `planet_osm_line` and `planet_osm_polygon` tables produced by osm2pgsql's classic pgsql output (the default output, not the flex output), in the default EPSG:3857 projection. The import must use `--hstore`, because country codes, state codes and postal codes are read from the `tags` column.

Download an extract (I used https://download.geofabrik.de/), then:

```sh
createdb osm
psql -d osm -c "CREATE EXTENSION postgis; CREATE EXTENSION hstore;"
osm2pgsql --create --slim --hstore -d osm your-region-latest.osm.pbf
```

osm2pgsql creates a spatial index on each table, which is enough to run. On larger imports, these optional partial indexes keep the most frequent queries small:

```sql
CREATE INDEX planet_osm_polygon_admin_way_gist ON planet_osm_polygon
  USING gist (way) WHERE boundary = 'administrative' AND name IS NOT NULL;

CREATE INDEX planet_osm_polygon_building_way_gist ON planet_osm_polygon
  USING gist (way) WHERE building IS NOT NULL;

CREATE INDEX planet_osm_point_place_way_gist ON planet_osm_point
  USING gist (way) WHERE place IN ('city', 'town', 'village') AND name IS NOT NULL;

ANALYZE;
```

The server inspects the table columns on first use to find out whether address tags such as `addr:housenumber` were imported as columns or into the hstore, so both layouts work.

## Installation

From the repository root:

```sh
npm ci
cp .env.example .env
```

Edit `.env` with your database connection details (see Configuration below), then build the dashboard and start the server:

```sh
npm run build
npm start
```

Open http://localhost:3007.

Building the dashboard is optional. The page is really just for internal testing. Without a build, the server serves `public/index.html` at `/` instead: a single-file test page with no build step or dependencies, useful for checking a new setup.s

### Development

```sh
npm run dev                  # API server, restarts on changes to server.js
cd frontend && npm run dev   # Vite dev server on port 5173, proxies API calls to port 3007
```

If the API runs elsewhere, set `API_URL` (for example `API_URL=http://localhost:4000`) before starting the Vite dev server.

## Configuration

Settings are read from environment variables. A `.env` file next to `server.js` is loaded automatically; variables already set in the environment take precedence over it.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3007` | HTTP port |
| `HOST` | all interfaces | Interface to bind, for example `127.0.0.1` behind a reverse proxy |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGDATABASE` | `osm` | Database name |
| `PGUSER` | `postgres` | Database user |
| `PGPASSWORD` | none | Database password |
| `DATABASE_URL` | none | Connection string; overrides the `PG*` variables when set |
| `ADMIN_TOKEN` | none | Enables the admin panel. Must be at least 16 characters |
| `STATS_FILE` | `stats.json` beside `server.js` | Where request counters are persisted |

Generate an admin token with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## API

All endpoints return JSON. Coordinates are WGS84 decimal degrees; `lat` must be between -90 and 90 and `lon` between -180 and 180. GET endpoints take `lat` and `lon` as query parameters; POST endpoints take a JSON body.

| Method | Path | Returns |
| --- | --- | --- |
| GET, POST | `/city` | City name |
| GET, POST | `/place` | Name of the building, point of interest or area at the point |
| GET, POST | `/building` | The building at the point, with address and footprint |
| GET | `/road` | Nearest named road |
| GET, POST | `/lookup` | City, place, road, state, county and country together |
| POST | `/cities/batch` | City for each of up to 100 points |
| POST | `/lookup/batch` | Full lookup for each of up to 100 points |
| GET | `/health` | Database connectivity check |

### GET /lookup

```sh
curl "http://localhost:3007/lookup?lat=38.981997&lon=-76.937028"
```

Example response:

```json
{
  "city": "Cupertino",
  "place_name": "Apple Park",
  "state": "California",
  "state_code": "CA",
  "county": "Example County",
  "country": "United States",
  "country_code": "US",
  "road": "Road Drive",
  "road_type": "tertiary",
  "road_distance_m": 41.7,
  "lat": 38.981997,
  "lon": -76.937028
}
```

Fields that cannot be resolved are `null`; `city` and `place_name` are `"unknown"` instead.

### /city

This returns `{ city, lat, lon }`. The city is the smallest municipal boundary (OSM `admin_level=8`) containing the point. Where there is none, the nearest city, town or village point within 50 km is used.

### /place

Returns `{ place_name, lat, lon }`, chosen in this order of priority:

1. A named building containing the point
2. The nearest named building within 200 m
3. A named point-of-interest area containing the point (amenity, shop, tourism or leisure; universities, colleges and schools are skipped so the building inside them wins)
4. The nearest point of interest within 200 m
5. Any named area containing the point

### /building

The click-to-identify endpoint. Unlike `/place`, which always widens its search until it finds a name, this reports what the point actually landed on.

Query parameters (or body fields): `lat`, `lon`, and an optional `radius` in metres (default 25, maximum 250). If the point is not inside a footprint, the nearest named building within `radius` is returned and marked as `nearby`. `radius=0` turns that off.

| Field | Description |
| --- | --- |
| `found` | Whether a building or point-of-interest area was matched |
| `name` | Its name, if it has one |
| `kind` | `building` or `poi` |
| `match` | `inside` or `nearby` |
| `inside` | `true` when the point is inside the footprint |
| `distance_m` | Distance to the footprint in metres (0 when inside) |
| `address` | Street line, for example `"4131 Campus Drive"` |
| `address_full` | One-line address with city, state and postcode |
| `address_parts` | `{ unit, housenumber, street, city, state, postcode }` |
| `address_source` | `footprint` when tagged on the building, `node` when taken from an address point inside it |
| `postcode` | Postcode from the building, its address point, or the postal boundary |
| `postcode_tag` | Postcode tagged on the building or its address point only, without the boundary fallback |
| `building_type` | The OSM `building` value (or the amenity, shop, tourism or leisure value for an area), when more specific than `yes` |
| `geometry` | Footprint as GeoJSON in EPSG:4326 |
| `geometry_omitted` | `true` when the footprint was too large (over 400 KB) to include |
| `radius_m` | The snap radius that was applied |

The response also includes the same city, state, county, country and road fields as `/lookup`. An address is only reported when it has both a house number and a street, and an address point is only used when it lies inside the matched footprint, so a neighbour's address is never returned.

### /road

Returns `{ road, road_type, road_distance_m, lat, lon }` for the nearest road with a name or reference number within 200 m. `road_type` is the OSM `highway` value.

### Batch endpoints

```sh
curl -X POST http://localhost:3007/lookup/batch \
  -H "Content-Type: application/json" \
  -d '{"points":[{"lat":38.98,"lon":-76.94},{"lat":39.30,"lon":-76.81}]}'
```

Returns `{ results: [{ index, lat, lon, ... }] }` in request order. If any point is invalid, nothing is looked up and the response is a 400 listing the bad entries by index.

### Errors

| Status | Body |
| --- | --- |
| 400 | `{ "error": "lat must be between -90 and 90" }` and similar validation messages, or `{ "error": "Invalid request body" }` for malformed JSON |
| 413 | `{ "error": "Request body too large" }` for bodies over 100 KB |
| 500 | `{ "error": "Database query failed" }`; the underlying error is logged on the server only. Queries are cancelled after 15 seconds |
| 503 | `/health` only: `{ "status": "error", "db": "disconnected" }` |

### Caching

Results are cached in memory, keyed to coordinates rounded to four decimal places (about 11 m). `/building` results are keyed to five decimal places plus the radius, and their cache is also capped at 32 MB of footprint GeoJSON. The cache is cleared on restart.

## Admin panel

Set `ADMIN_TOKEN` and restart the server, then open `/#/admin` and sign in with the token. While `ADMIN_TOKEN` is unset, the panel, its statistics socket and the log stream are all disabled.

The panel shows requests per second, a five-minute request graph, totals over periods from one hour to all time, a per-endpoint breakdown, and a live server console. Request counts are saved to `STATS_FILE` every 30 seconds and on shutdown, and per-minute history is kept for one year. `/building` requests are counted under `place`, and a batch request counts once regardless of how many points it contains.

Signing in sets an HttpOnly, SameSite=Strict session cookie that lasts seven days and is marked Secure over HTTPS. Signing out clears the cookie in that browser only; changing `ADMIN_TOKEN` and restarting revokes every session.

## Deploying publicly

- **TLS and proxying.** Put the server behind a reverse proxy such as nginx or Caddy that terminates TLS, and set `HOST=127.0.0.1`. The proxy has to pass WebSocket upgrades for `/ws/stats`, must not buffer `/console/stream` (in nginx, `proxy_buffering off`), and should send `X-Forwarded-Proto` so the admin cookie is marked Secure.
- **Rate limiting.** There is none built out-of-the-box. I'll probably add a feature later for this. A single `/lookup/batch` request can run more than a thousand queries, so limit requests at the proxy, and limit `POST /admin/login` tightly as well.
- **Read-only database role.** The server only reads, so connect with a role that can do nothing else:

  ```sql
  CREATE ROLE origin LOGIN PASSWORD 'change-me';
  GRANT CONNECT ON DATABASE osm TO origin;
  GRANT USAGE ON SCHEMA public TO origin;
  GRANT SELECT ON planet_osm_point, planet_osm_line, planet_osm_polygon TO origin;
  ```

- **CORS.** The lookup endpoints allow requests from any origin, since the API is meant to be called from other sites. The admin endpoints do not rely on CORS; their session cookie is never sent with cross-site requests.
- **Logging.** Every API request is logged to stdout with its path and query string, which for GET lookups includes the coordinates.

## Notes and limitations

- osm2pgsql stores geometry in Web Mercator (EPSG:3857), where one map unit is a true metre only at the equator. The fixed search radii of `/city` (50 km), `/place` (200 m) and `/road` (200 m), and the `road_distance_m` value, are in map units, so they shrink in true distance away from the equator; 200 units is about 155 m at latitude 39 degrees. `/building` corrects for this, and its `radius` and `distance_m` are true metres.
- Results are only as complete as the OSM data you import. Many residential buildings carry no tags at all; `/building` finds them by footprint and looks for an address point inside them.
- Postal boundaries are sparse outside Europe, so postcodes come from address tags first.

## Project structure

```
server.js               Entry point: middleware, routing and startup
lib/
  config.js             Settings from the environment and .env
  db.js                 PostgreSQL pool and the shared query helper
  routes.js             API endpoints and input validation
  geocode.js            City, place, state, county, country, road and postcode lookups
  building.js           Building identification, footprints and address resolution
  address.js            Address parsing and formatting
  osm-schema.js         Detects where the osm2pgsql import stored address tags
  lru-cache.js          Result cache
  stats.js              Request counters and their persistence
  admin-auth.js         Admin token login and session cookies
  stats-socket.js       Live statistics WebSocket for the admin panel
  console-stream.js     Server log stream for the admin panel
public/index.html       Single-file test page, served at / when there is no dashboard build
frontend/               React and Vite dashboard: live tester, endpoint list, admin panel
.env.example            Configuration template
```

## License

The code is released under the MIT License; see [LICENSE](LICENSE).

Map data is copyright OpenStreetMap contributors and available under the Open Database License (ODbL). If you serve results publicly, attribute OpenStreetMap as described at https://www.openstreetmap.org/copyright. The bundled dashboard and test page already show this credit.
