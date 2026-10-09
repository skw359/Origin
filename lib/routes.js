const express = require('express');
const { pool } = require('./db');
const geocode = require('./geocode');
const { identifyBuilding } = require('./building');

const BATCH_MAX = 100;
const RADIUS_DEFAULT_M = 25;
const RADIUS_MAX_M = 250;

class BadRequest extends Error {}

function validateCoords(lat, lon) {
  const la = parseFloat(lat);
  const lo = parseFloat(lon);
  if (isNaN(la) || isNaN(lo)) return { error: 'lat and lon must be numbers' };
  if (la < -90 || la > 90) return { error: 'lat must be between -90 and 90' };
  if (lo < -180 || lo > 180) return { error: 'lon must be between -180 and 180' };
  return { lat: la, lon: lo };
}

function parseRadius(raw) {
  if (raw === undefined || raw === null || raw === '') return RADIUS_DEFAULT_M;
  const r = parseFloat(raw);
  if (isNaN(r) || r < 0) throw new BadRequest('radius must be a non-negative number');
  return Math.min(r, RADIUS_MAX_M);
}

// GET reads the query string and POST the JSON body; both answer the same.
function pointHandler(lookup) {
  return async (req, res) => {
    const input = req.method === 'GET' ? req.query : req.body || {};
    const { error, lat, lon } = validateCoords(input.lat, input.lon);
    if (error) return res.status(400).json({ error });

    try {
      res.json({ ...(await lookup(lat, lon, input)), lat, lon });
    } catch (err) {
      if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
      console.error('Query error:', err.message);
      res.status(500).json({ error: 'Database query failed' });
    }
  };
}

// Nothing is looked up unless every point is valid.
function batchHandler(lookup) {
  return async (req, res) => {
    const points = req.body?.points;
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: 'points must be a non-empty array' });
    }
    if (points.length > BATCH_MAX) {
      return res.status(400).json({ error: `Maximum ${BATCH_MAX} points per batch request` });
    }

    const validated = points.map((p, index) => ({ index, ...validateCoords(p?.lat, p?.lon) }));
    const invalid = validated.filter((v) => v.error);
    if (invalid.length > 0) return res.status(400).json({ error: 'Invalid coordinates', invalid });

    try {
      const results = await Promise.all(validated.map(async ({ index, lat, lon }) => (
        { index, lat, lon, ...(await lookup(lat, lon)) }
      )));
      res.json({ results });
    } catch (err) {
      console.error('Batch query error:', err.message);
      res.status(500).json({ error: 'Database query failed' });
    }
  };
}

const city = async (lat, lon) => ({ city: await geocode.lookupCity(lat, lon) });
const place = async (lat, lon) => ({ place_name: await geocode.lookupPlace(lat, lon) });
const building = (lat, lon, input) => identifyBuilding(lat, lon, parseRadius(input.radius));

const router = express.Router();

router.get('/city', pointHandler(city));
router.post('/city', pointHandler(city));
router.get('/place', pointHandler(place));
router.post('/place', pointHandler(place));
router.get('/building', pointHandler(building));
router.post('/building', pointHandler(building));
router.get('/road', pointHandler(geocode.lookupRoad));
router.get('/lookup', pointHandler(geocode.lookupAll));
router.post('/lookup', pointHandler(geocode.lookupAll));
router.post('/cities/batch', batchHandler(city));
router.post('/lookup/batch', batchHandler(geocode.lookupAll));

router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

module.exports = router;
