const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./lib/config');
const { captureConsole, streamHandler } = require('./lib/console-stream');
const { adminRouter, adminEnabled } = require('./lib/admin-auth');
const stats = require('./lib/stats');
const apiRouter = require('./lib/routes');
const attachStatsSocket = require('./lib/stats-socket');
const { lookupAll } = require('./lib/geocode');

captureConsole();
stats.start();

const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(config.root, 'frontend', 'dist')));
// Without a frontend build, / serves the single-file test page instead.
app.use(express.static(path.join(config.root, 'public')));

app.use('/admin', adminRouter);
app.get('/console/stream', streamHandler);

app.use((req, res, next) => {
  const query = Object.keys(req.query).length ? ' ' + JSON.stringify(req.query) : '';
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}${query}`);
  stats.record(req.path);
  next();
});

app.use(apiRouter);

app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('Unhandled error:', err.message);
  res.status(status).json({
    error: status === 413 ? 'Request body too large'
      : status === 500 ? 'Internal server error'
      : 'Invalid request body',
  });
});

const server = http.createServer(app);
attachStatsSocket(server);

server.listen(config.port, config.host, () => {
  console.log(`Origin API running on http://${config.host || 'localhost'}:${config.port}`);
  console.log(adminEnabled ? 'Admin panel: /#/admin' : 'Admin panel: disabled (set ADMIN_TOKEN to enable)');
  if (!config.db.connectionString && config.db.password === undefined) {
    console.log('Note: PGPASSWORD is not set; connecting to PostgreSQL without a password.');
  }

  lookupAll(0, 0).then(() => console.log('Prepared statements warmed up')).catch(() => {});
});
