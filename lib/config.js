const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// loadEnvFile never overwrites variables already set in the environment.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const ADMIN_TOKEN_MIN_LENGTH = 16;

let adminToken = process.env.ADMIN_TOKEN || '';
if (adminToken && adminToken.length < ADMIN_TOKEN_MIN_LENGTH) {
  console.error(`ADMIN_TOKEN must be at least ${ADMIN_TOKEN_MIN_LENGTH} characters; admin panel disabled.`);
  adminToken = '';
}

module.exports = {
  root: ROOT,
  port: Number(process.env.PORT) || 3007,
  host: process.env.HOST || undefined,
  adminToken,
  statsFile: process.env.STATS_FILE
    ? path.resolve(process.env.STATS_FILE)
    : path.join(ROOT, 'stats.json'),
  // Standard libpq names, so psql reads the same settings. DATABASE_URL wins
  // over the individual values when set.
  db: {
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || 'osm',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
  },
};
