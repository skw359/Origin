const { pool } = require('./db');

const ADDR_KEYS = ['addr:unit', 'addr:housenumber', 'addr:housename', 'addr:street', 'addr:city', 'addr:state', 'addr:postcode'];

const ADDR_ALIASES = {
  'addr:unit': 'unit',
  'addr:housenumber': 'housenumber',
  'addr:street': 'street',
  'addr:city': 'addr_city',
  'addr:state': 'addr_state',
  'addr:postcode': 'addr_postcode',
};

// osm2pgsql's default style promotes some addr:* keys (housenumber,
// housename) to columns and --hstore puts the rest in `tags`, so where a key
// lives depends on the import. The schema is probed once and the SELECT lists
// are built from what exists.
//
// A failed probe is not memoised: statements prepared from a guessed schema
// would later clash with the real one under the same name.
let probe = null;

function getSchemaColumns() {
  if (!probe) {
    probe = probeSchemaColumns().catch((err) => {
      probe = null;
      throw err;
    });
  }
  return probe;
}

async function probeSchemaColumns() {
  const { rows } = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_name IN ('planet_osm_polygon', 'planet_osm_point');
  `);
  const cols = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  const report = (table) => ADDR_KEYS.filter((k) => cols.has(`${table}.${k}`)).join(', ') || 'none';
  console.log(`[building] addr columns on planet_osm_polygon: ${report('planet_osm_polygon')}`);
  console.log(`[building] addr columns on planet_osm_point:   ${report('planet_osm_point')}`);
  console.log(`[building] hstore tags: polygon=${cols.has('planet_osm_polygon.tags')} point=${cols.has('planet_osm_point.tags')}`);
  return cols;
}

// SQL for one tag's value. A promoted column wins over the hstore, since
// osm2pgsql writes the tag there when both exist.
function tagExpr(alias, table, key, cols) {
  const parts = [];
  if (cols.has(`${table}.${key}`)) parts.push(`NULLIF(${alias}."${key}", '')`);
  if (cols.has(`${table}.tags`)) parts.push(`NULLIF(${alias}.tags->'${key}', '')`);
  if (parts.length === 0) return 'NULL::text';
  if (parts.length === 1) return `${parts[0]}::text`;
  return `COALESCE(${parts.join(', ')})::text`;
}

function addrCols(alias, table, cols) {
  return Object.keys(ADDR_ALIASES)
    .map((k) => `${tagExpr(alias, table, k, cols)} AS ${ADDR_ALIASES[k]}`)
    .join(',\n               ');
}

module.exports = { getSchemaColumns, tagExpr, addrCols };
