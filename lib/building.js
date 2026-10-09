const LRUCache = require('./lru-cache');
const { queryPoint, POINT } = require('./db');
const geocode = require('./geocode');
const { getSchemaColumns, tagExpr, addrCols } = require('./osm-schema');
const { addressPartsFrom, hasStreetAddress, formatStreetLine, composeAddress } = require('./address');

// A campus or park outline can run to megabytes; past this the name is
// returned without it.
const GEOJSON_MAX_BYTES = 400000;

// Only nodes inside the matched footprint are used, so this just bounds the
// search: wide enough to reach across a building the point snapped to.
const ADDRESS_NODE_RADIUS_M = 60;

// Also capped by total GeoJSON size: every point inside a large park or
// campus caches its own copy of the same big polygon.
const cache = new LRUCache(5000, 32 * 1024 * 1024);

const NOT_FOUND = {
  found: false,
  name: null,
  kind: null,
  match: null,
  inside: false,
  distance_m: null,
  address: null,
  address_parts: null,
  address_source: null,
  postcode_tag: null,
  building_type: null,
  geometry: null,
  geometry_omitted: false,
};

function parseGeometry(geojson) {
  if (!geojson) return { geometry: null, geometry_omitted: false };
  if (geojson.length > GEOJSON_MAX_BYTES) return { geometry: null, geometry_omitted: true };
  try {
    return { geometry: JSON.parse(geojson), geometry_omitted: false };
  } catch {
    return { geometry: null, geometry_omitted: true };
  }
}

// Ray casting over a GeoJSON ring in lon/lat.
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = (yi > lat) !== (yj > lat);
    if (straddles && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates
    : geometry.type === 'Polygon' ? [geometry.coordinates]
    : [];
  for (const [outer, ...holes] of polygons) {
    if (!outer || !pointInRing(lon, lat, outer)) continue;
    if (!holes.some((hole) => pointInRing(lon, lat, hole))) return true;
  }
  return false;
}

// Most residential buildings carry no tags; the address lives on a separate
// node inside the outline.
async function lookupAddressNode(lat, lon, mercRadius) {
  const cols = await getSchemaColumns();
  const houseNumber = tagExpr('pt', 'planet_osm_point', 'addr:housenumber', cols);
  if (houseNumber === 'NULL::text') return null;

  try {
    const { rows } = await queryPoint('address_node_nearest', `
      SELECT ${addrCols('pt', 'planet_osm_point', cols)},
             ST_X(ST_Transform(pt.way, 4326)) AS lon,
             ST_Y(ST_Transform(pt.way, 4326)) AS lat,
             ST_Distance(pt.way, ${POINT}) AS merc_distance
      FROM planet_osm_point pt
      WHERE ${houseNumber} IS NOT NULL
        AND ST_DWithin(pt.way, ${POINT}, $3)
      ORDER BY pt.way <-> ${POINT}
      LIMIT 1;
    `, lat, lon, mercRadius);
    return rows[0] || null;
  } catch (err) {
    console.error('Address node query failed:', err.message);
    return null;
  }
}

// Only an address node inside this footprint is used; one merely near the
// point is likely the neighbour's. Nodes often carry just number and street,
// so the footprint's city, state and postcode fill in the rest.
function addressFromNode(node, geometry, footprintParts) {
  if (!node) return null;
  const nodeParts = addressPartsFrom(node);
  if (!hasStreetAddress(nodeParts)) return null;
  if (!pointInGeometry(parseFloat(node.lon), parseFloat(node.lat), geometry)) return null;
  return {
    ...nodeParts,
    city: nodeParts.city || footprintParts.city,
    state: nodeParts.state || footprintParts.state,
    postcode: nodeParts.postcode || footprintParts.postcode,
  };
}

// Radii and distances here are true metres. One EPSG:3857 unit is cos(lat)
// metres, so searches divide by that scale and distances multiply by it.
async function lookupBuilding(lat, lon, radius) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)},${radius}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const cols = await getSchemaColumns();
  const ADDR = addrCols('pol', 'planet_osm_polygon', cols);
  const HOUSENAME = tagExpr('pol', 'planet_osm_polygon', 'addr:housename', cols);
  const mercScale = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);

  // The address node is fetched in parallel even though it is usually unused,
  // to avoid a second round trip.
  const [insideBuilding, insidePoi, addressNode] = await Promise.all([
    // Smallest footprint wins, so a shop unit beats the mall around it.
    queryPoint('building_inside', `
      SELECT COALESCE(NULLIF(pol.name, ''), ${HOUSENAME}) AS name,
             pol.building AS build_tag,
             ${ADDR},
             ST_AsGeoJSON(ST_Transform(pol.way, 4326), 6) AS geojson
      FROM planet_osm_polygon pol
      WHERE pol.building IS NOT NULL
        AND pol.building <> 'no'
        AND pol.way && ${POINT}
        AND ST_Intersects(pol.way, ${POINT})
      ORDER BY ST_Area(pol.way) ASC
      LIMIT 1;
    `, lat, lon),
    // Unlike /place, campuses count here: bare ground on one should still name it.
    queryPoint('building_inside_poi', `
      SELECT pol.name AS name,
             COALESCE(pol.amenity, pol.shop, pol.tourism, pol.leisure) AS build_tag,
             ${ADDR},
             ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(pol.way, 5), 4326), 6) AS geojson
      FROM planet_osm_polygon pol
      WHERE pol.name IS NOT NULL
        AND pol.way && ${POINT}
        AND ST_Intersects(pol.way, ${POINT})
        AND (pol.amenity IS NOT NULL OR pol.shop IS NOT NULL
             OR pol.tourism IS NOT NULL OR pol.leisure IS NOT NULL)
      ORDER BY ST_Area(pol.way) ASC
      LIMIT 1;
    `, lat, lon),
    lookupAddressNode(lat, lon, ADDRESS_NODE_RADIUS_M / mercScale),
  ]);

  let row = null;
  let kind = null;
  let match = null;

  if (insideBuilding.rows.length > 0) {
    [row, kind, match] = [insideBuilding.rows[0], 'building', 'inside'];
  } else if (insidePoi.rows.length > 0) {
    [row, kind, match] = [insidePoi.rows[0], 'poi', 'inside'];
  } else if (radius > 0) {
    // Click tolerance: a cursor or finger misses a narrow rowhouse by a few
    // metres, so snap to the nearest named footprint and report it as nearby.
    const near = await queryPoint('building_nearest', `
      SELECT COALESCE(NULLIF(pol.name, ''), ${HOUSENAME}) AS name,
             pol.building AS build_tag,
             ${ADDR},
             ST_AsGeoJSON(ST_Transform(pol.way, 4326), 6) AS geojson,
             ST_Distance(pol.way, ${POINT}) AS merc_distance
      FROM planet_osm_polygon pol
      WHERE pol.building IS NOT NULL
        AND pol.building <> 'no'
        AND (pol.name IS NOT NULL OR ${HOUSENAME} IS NOT NULL)
        AND ST_DWithin(pol.way, ${POINT}, $3)
      ORDER BY pol.way <-> ${POINT}
      LIMIT 1;
    `, lat, lon, radius / mercScale);
    if (near.rows.length > 0) [row, kind, match] = [near.rows[0], 'building', 'nearby'];
  }

  if (!row) {
    cache.set(key, NOT_FOUND);
    return NOT_FOUND;
  }

  const { geometry, geometry_omitted } = parseGeometry(row.geojson);
  const footprintParts = addressPartsFrom(row);

  let parts = hasStreetAddress(footprintParts) ? footprintParts : null;
  let address_source = parts ? 'footprint' : null;
  // An address node inside a campus or park belongs to some building in it,
  // not to the area itself.
  if (!parts && kind === 'building') {
    parts = addressFromNode(addressNode, geometry, footprintParts);
    if (parts) address_source = 'node';
  }

  const result = {
    found: true,
    name: row.name || null,
    kind,
    match,
    inside: match === 'inside',
    distance_m: match === 'inside' ? 0 : Math.round(parseFloat(row.merc_distance) * mercScale * 10) / 10,
    address: parts ? formatStreetLine(parts.unit, parts.housenumber, parts.street) : null,
    address_parts: parts,
    address_source,
    // Kept even when there is no street address to attach it to.
    postcode_tag: (parts && parts.postcode) || footprintParts.postcode || null,
    building_type: row.build_tag && row.build_tag !== 'yes' ? row.build_tag : null,
    geometry,
    geometry_omitted,
  };
  cache.set(key, result, 1 + (geometry ? row.geojson.length : 0));
  return result;
}

// What the point landed on, with the location context a map popup needs in
// the same response.
async function identifyBuilding(lat, lon, radius) {
  const [building, city, state, county, country, road, boundaryPostcode] = await Promise.all([
    lookupBuilding(lat, lon, radius),
    geocode.lookupCity(lat, lon),
    geocode.lookupState(lat, lon),
    geocode.lookupCounty(lat, lon),
    geocode.lookupCountry(lat, lon),
    geocode.lookupRoad(lat, lon),
    geocode.lookupPostcode(lat, lon),
  ]);

  const postcode = building.postcode_tag || boundaryPostcode || null;
  const address_full = composeAddress(building.address_parts, {
    city,
    state_code: state.state_code,
    postcode,
  });

  return {
    ...building,
    address_full,
    postcode,
    city,
    ...state,
    county,
    ...country,
    ...road,
    radius_m: radius,
  };
}

module.exports = { identifyBuilding };
