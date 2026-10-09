const { isAdmin } = require('./admin-auth');

const HISTORY_MAX = 200;
const MSG_MAX_CHARS = 2000;
// A stalled viewer would otherwise buffer every log line in server memory.
const MAX_BUFFERED_BYTES = 1024 * 1024;

const history = [];
const clients = new Set();

function push(level, msg) {
  if (msg.length > MSG_MAX_CHARS) msg = msg.slice(0, MSG_MAX_CHARS) + '…';
  const entry = { ts: new Date().toISOString(), level, msg };
  history.push(entry);
  if (history.length > HISTORY_MAX) history.shift();
  for (const client of clients) {
    if (client.writableLength > MAX_BUFFERED_BYTES) {
      clients.delete(client);
      client.destroy();
      continue;
    }
    client.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

function captureConsole() {
  const log = console.log.bind(console);
  const error = console.error.bind(console);
  console.log = (...args) => { log(...args); push('log', args.join(' ')); };
  console.error = (...args) => { error(...args); push('error', args.join(' ')); };
}

// Every request line passes through here, coordinates included.
function streamHandler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const entry of history) res.write(`data: ${JSON.stringify(entry)}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

module.exports = { captureConsole, streamHandler };
