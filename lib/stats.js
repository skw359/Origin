const fs = require('fs');
const config = require('./config');

const ENDPOINTS = ['city', 'place', 'road', 'lookup'];
const GRAPH_SECONDS = 300;
const HOUR = 3600000;
const RETENTION_MS = 365 * 24 * HOUR;
const TIMEFRAMES = {
  '1h': HOUR,
  '12h': 12 * HOUR,
  '24h': 24 * HOUR,
  '48h': 48 * HOUR,
  '96h': 96 * HOUR,
  '1mo': 30 * 24 * HOUR,
  '3mo': 90 * 24 * HOUR,
  '1yr': RETENTION_MS,
};

const perSecond = []; // request totals for the last GRAPH_SECONDS seconds
let currentSecond = Math.floor(Date.now() / 1000);
let currentCount = 0;
const minuteBuckets = new Map(); // minute start (ms) -> per-endpoint counts
const allTime = { city: 0, place: 0, road: 0, lookup: 0 };

const sum = (counts) => ENDPOINTS.reduce((total, ep) => total + counts[ep], 0);
const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;

// stats.json and the admin panel know exactly these four keys, so /building
// counts as place, and a batch counts once per request.
function classify(path) {
  if (path === '/city' || path === '/cities/batch') return 'city';
  if (path === '/place' || path === '/building') return 'place';
  if (path === '/road') return 'road';
  if (path === '/lookup' || path === '/lookup/batch') return 'lookup';
  return null;
}

function advanceSecond() {
  const now = Math.floor(Date.now() / 1000);
  if (now === currentSecond) return;
  perSecond.push(currentCount);
  if (perSecond.length > GRAPH_SECONDS) perSecond.shift();
  currentSecond = now;
  currentCount = 0;
}

function record(path) {
  const endpoint = classify(path);
  if (!endpoint) return;

  advanceSecond();
  currentCount++;
  allTime[endpoint]++;

  const minute = Math.floor(Date.now() / 60000) * 60000;
  let bucket = minuteBuckets.get(minute);
  if (!bucket) {
    bucket = { city: 0, place: 0, road: 0, lookup: 0 };
    minuteBuckets.set(minute, bucket);
  }
  bucket[endpoint]++;
}

function countSince(cutoff) {
  const counts = { city: 0, place: 0, road: 0, lookup: 0 };
  for (const [minute, bucket] of minuteBuckets) {
    if (minute < cutoff) continue;
    for (const ep of ENDPOINTS) counts[ep] += bucket[ep];
  }
  return { ...counts, total: sum(counts) };
}

function payload() {
  advanceSecond();
  const now = Date.now();
  const total = sum(allTime);

  const timeframes = {};
  for (const [label, ms] of Object.entries(TIMEFRAMES)) timeframes[label] = countSince(now - ms);
  timeframes.all = { ...allTime, total };

  const endpoints = {};
  for (const ep of ENDPOINTS) {
    endpoints[ep] = { count: allTime[ep], pct: round1((allTime[ep] / (total || 1)) * 100) };
  }

  return {
    rps: round1(average(perSecond.slice(-5))),
    throughput: round1(average(perSecond.slice(-60))),
    graph: perSecond,
    timeframes,
    endpoints,
  };
}

function load() {
  try {
    if (!fs.existsSync(config.statsFile)) return;
    const saved = JSON.parse(fs.readFileSync(config.statsFile, 'utf8'));
    for (const ep of ENDPOINTS) allTime[ep] = saved.allTimeTotals?.[ep] || 0;
    for (const [minute, bucket] of saved.minuteBuckets || []) minuteBuckets.set(Number(minute), bucket);
    console.log(`Stats loaded: ${sum(allTime)} total requests from disk`);
  } catch (err) {
    console.error('Failed to load stats from disk:', err.message);
  }
}

function save() {
  try {
    const data = {
      allTimeTotals: { ...allTime },
      minuteBuckets: [...minuteBuckets.entries()],
      savedAt: new Date().toISOString(),
    };
    // Write-then-rename: a crash mid-write must not leave a truncated file
    // that the next start fails to parse and then overwrites with zeros.
    const tmp = `${config.statsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, config.statsFile);
  } catch (err) {
    console.error('Failed to save stats:', err.message);
  }
}

function prune() {
  const cutoff = Date.now() - RETENTION_MS;
  for (const minute of minuteBuckets.keys()) {
    if (minute < cutoff) minuteBuckets.delete(minute);
  }
}

function start() {
  load();
  setInterval(save, 30000);
  setInterval(prune, HOUR);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      save();
      process.exit(0);
    });
  }
}

module.exports = { start, record, payload };
