const { WebSocketServer } = require('ws');
const { isAdmin } = require('./admin-auth');
const stats = require('./stats');

// A viewer this far behind is skipped rather than queued more.
const MAX_BUFFERED_BYTES = 1024 * 1024;

function attachStatsSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // Node removes its own socket error handler before 'upgrade'; without one,
    // a client reset is an uncaught error that kills the process.
    socket.on('error', () => socket.destroy());

    let pathname;
    try {
      // Throws on request targets like "//", which would also be fatal here.
      ({ pathname } = new URL(req.url, 'http://localhost'));
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws/stats') {
      socket.destroy();
      return;
    }
    if (!isAdmin(req)) {
      socket.once('finish', () => socket.destroy());
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    // An invalid frame surfaces as an 'error' event, fatal if unhandled.
    ws.on('error', () => ws.terminate());
    ws.send(JSON.stringify(stats.payload()));
  });

  // Once a second rather than per request: the payload scans every minute bucket.
  setInterval(() => {
    if (wss.clients.size === 0) return;
    const payload = JSON.stringify(stats.payload());
    for (const client of wss.clients) {
      if (client.readyState === 1 && client.bufferedAmount < MAX_BUFFERED_BYTES) client.send(payload);
    }
  }, 1000);
}

module.exports = attachStatsSocket;
