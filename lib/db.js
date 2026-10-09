const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  ...config.db,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Keeps a runaway query from holding one of the 20 connections forever.
  statement_timeout: 15000,
});

// An idle client dropped by the database emits 'error', which kills the
// process if nothing listens for it.
pool.on('error', (err) => {
  console.error('Idle database client error:', err.message);
});

// The query point ($1 = lon, $2 = lat) in osm2pgsql's EPSG:3857.
const POINT = 'ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857)';

function queryPoint(name, text, lat, lon, ...extra) {
  return pool.query({ name, text, values: [lon, lat, ...extra] });
}

module.exports = { pool, queryPoint, POINT };
