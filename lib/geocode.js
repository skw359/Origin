const LRUCache = require('./lru-cache');
const { queryPoint, POINT } = require('./db');

const cityCache = new LRUCache(50000);
const placeCache = new LRUCache(50000);
const roadCache = new LRUCache(50000);
const stateCache = new LRUCache(10000);
const countyCache = new LRUCache(10000);
const countryCache = new LRUCache(10000);
const postcodeCache = new LRUCache(10000);

// Four decimal places is about 11 m.
function cellKey(lat, lon) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

async function cached(cache, lat, lon, compute) {
  const key = cellKey(lat, lon);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const val = await compute();
  cache.set(key, val);
  return val;
}

function firstName(result) {
  return (result.rows.length > 0 && result.rows[0].name) || null;
}

function adminAreaSql(level, columns) {
  return `
    SELECT ${columns}
    FROM planet_osm_polygon a
    WHERE a.boundary = 'administrative'
      AND a.admin_level = '${level}'
      AND a.name IS NOT NULL
      AND a.way && ${POINT}
      AND ST_Intersects(a.way, ${POINT})
    ORDER BY ST_Area(a.way) ASC
    LIMIT 1;
  `;
}

function lookupCity(lat, lon) {
  return cached(cityCache, lat, lon, async () => {
    const [municipality, settlement] = await Promise.all([
      queryPoint('city_admin', adminAreaSql(8, 'a.name'), lat, lon),
      queryPoint('city_place', `
        SELECT pt.name
        FROM planet_osm_point pt
        WHERE pt.place IN ('city', 'town', 'village')
          AND pt.name IS NOT NULL
          AND ST_DWithin(pt.way, ${POINT}, 50000)
        ORDER BY pt.way <-> ${POINT}
        LIMIT 1;
      `, lat, lon),
    ]);
    return firstName(municipality) || firstName(settlement) || 'unknown';
  });
}

// All five candidates are queried in parallel; the first one found, in this
// order, wins.
function lookupPlace(lat, lon) {
  return cached(placeCache, lat, lon, async () => {
    const results = await Promise.all([
      queryPoint('place_inside_building', `
        SELECT COALESCE(NULLIF(pol.name, ''), NULLIF(pol.tags->'addr:housename', '')) AS name
        FROM planet_osm_polygon pol
        WHERE pol.building IS NOT NULL
          AND (pol.name IS NOT NULL OR pol.tags ? 'addr:housename')
          AND pol.way && ${POINT}
          AND ST_Intersects(pol.way, ${POINT})
        ORDER BY ST_Area(pol.way) ASC
        LIMIT 1;
      `, lat, lon),
      queryPoint('place_nearest_building', `
        SELECT COALESCE(NULLIF(pol.name, ''), NULLIF(pol.tags->'addr:housename', '')) AS name
        FROM planet_osm_polygon pol
        WHERE pol.building IS NOT NULL
          AND (pol.name IS NOT NULL OR pol.tags ? 'addr:housename')
          AND ST_DWithin(pol.way, ${POINT}, 200)
        ORDER BY pol.way <-> ${POINT}
        LIMIT 1;
      `, lat, lon),
      // Campuses are skipped so the building inside them wins.
      queryPoint('place_inside_poi', `
        SELECT pol.name
        FROM planet_osm_polygon pol
        WHERE pol.name IS NOT NULL
          AND pol.way && ${POINT}
          AND ST_Intersects(pol.way, ${POINT})
          AND (pol.amenity IS NOT NULL OR pol.shop IS NOT NULL OR pol.tourism IS NOT NULL OR pol.leisure IS NOT NULL)
          AND COALESCE(pol.amenity, '') NOT IN ('university', 'college', 'school')
        ORDER BY ST_Area(pol.way) ASC
        LIMIT 1;
      `, lat, lon),
      queryPoint('place_nearest_poi', `
        SELECT pt.name
        FROM planet_osm_point pt
        WHERE pt.name IS NOT NULL
          AND (pt.amenity IS NOT NULL OR pt.shop IS NOT NULL OR pt.tourism IS NOT NULL OR pt.leisure IS NOT NULL)
          AND ST_DWithin(pt.way, ${POINT}, 200)
        ORDER BY pt.way <-> ${POINT}
        LIMIT 1;
      `, lat, lon),
      queryPoint('place_inside_any', `
        SELECT pol.name
        FROM planet_osm_polygon pol
        WHERE pol.name IS NOT NULL
          AND pol.way && ${POINT}
          AND ST_Intersects(pol.way, ${POINT})
        ORDER BY ST_Area(pol.way) ASC
        LIMIT 1;
      `, lat, lon),
    ]);
    return results.map(firstName).find(Boolean) || 'unknown';
  });
}

function lookupState(lat, lon) {
  return cached(stateCache, lat, lon, async () => {
    const { rows } = await queryPoint('lookup_state',
      adminAreaSql(4, `a.name, split_part(a.tags->'ISO3166-2', '-', 2) AS state_code`), lat, lon);
    return rows.length > 0
      ? { state: rows[0].name, state_code: rows[0].state_code || null }
      : { state: null, state_code: null };
  });
}

function lookupCounty(lat, lon) {
  return cached(countyCache, lat, lon, async () =>
    firstName(await queryPoint('lookup_county', adminAreaSql(6, 'a.name'), lat, lon)));
}

function lookupCountry(lat, lon) {
  return cached(countryCache, lat, lon, async () => {
    const { rows } = await queryPoint('lookup_country',
      adminAreaSql(2, `a.name, a.tags->'ISO3166-1:alpha2' AS country_code`), lat, lon);
    return rows.length > 0
      ? { country: rows[0].name, country_code: rows[0].country_code || null }
      : { country: null, country_code: null };
  });
}

function lookupRoad(lat, lon) {
  return cached(roadCache, lat, lon, async () => {
    const { rows } = await queryPoint('lookup_road', `
      SELECT COALESCE(NULLIF(l.name, ''), NULLIF(l.ref, '')) AS road,
             l.highway AS road_type,
             ST_Distance(l.way, ${POINT}) AS road_distance_m
      FROM planet_osm_line l
      WHERE l.highway IS NOT NULL
        AND (l.name IS NOT NULL OR l.ref IS NOT NULL)
        AND ST_DWithin(l.way, ${POINT}, 200)
      ORDER BY l.way <-> ${POINT}
      LIMIT 1;
    `, lat, lon);
    if (rows.length === 0) return { road: null, road_type: null, road_distance_m: null };
    return {
      road: rows[0].road,
      road_type: rows[0].road_type,
      road_distance_m: parseFloat(rows[0].road_distance_m),
    };
  });
}

// Best effort: postal boundaries are sparse outside Europe, and a failure
// here should not fail the building lookup that asked for it.
function lookupPostcode(lat, lon) {
  return cached(postcodeCache, lat, lon, async () => {
    const { rows } = await queryPoint('lookup_postcode', `
      SELECT COALESCE(NULLIF(a.tags->'postal_code', ''), NULLIF(a.name, '')) AS postcode
      FROM planet_osm_polygon a
      WHERE a.boundary = 'postal_code'
        AND a.way && ${POINT}
        AND ST_Intersects(a.way, ${POINT})
      ORDER BY ST_Area(a.way) ASC
      LIMIT 1;
    `, lat, lon);
    return (rows.length > 0 && rows[0].postcode) || null;
  }).catch(() => null);
}

async function lookupAll(lat, lon) {
  const [city, place_name, state, county, country, road] = await Promise.all([
    lookupCity(lat, lon),
    lookupPlace(lat, lon),
    lookupState(lat, lon),
    lookupCounty(lat, lon),
    lookupCountry(lat, lon),
    lookupRoad(lat, lon),
  ]);
  return { city, place_name, ...state, county, ...country, ...road };
}

module.exports = {
  lookupCity,
  lookupPlace,
  lookupState,
  lookupCounty,
  lookupCountry,
  lookupRoad,
  lookupPostcode,
  lookupAll,
};
