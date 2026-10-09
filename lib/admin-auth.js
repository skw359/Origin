const crypto = require('crypto');
const express = require('express');
const { adminToken } = require('./config');

const COOKIE = 'rg_admin';
const SESSION_MS = 7 * 24 * 3600 * 1000;

// Sessions are signed with a key derived from the token, so they survive
// restarts and all of them are revoked when the token changes.
const sessionKey = crypto.createHash('sha256').update(`rg-admin-session:${adminToken}`).digest();

function sign(value) {
  return crypto.createHmac('sha256', sessionKey).update(value).digest('base64url');
}

// Hashing first keeps the comparison constant-time for unequal lengths.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function isAdmin(req) {
  if (!adminToken) return false;
  const value = readCookie(req, COOKIE);
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot === -1) return false;
  const expires = value.slice(0, dot);
  if (!(Number(expires) > Date.now())) return false;
  return safeEqual(value.slice(dot + 1), sign(expires));
}

function sessionCookie(req, value, maxAgeSeconds) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  // Secure only ever restricts a cookie, so trusting the proxy header is safe.
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') attrs.push('Secure');
  return attrs.join('; ');
}

const adminRouter = express.Router();

adminRouter.get('/session', (req, res) => {
  res.json({ enabled: Boolean(adminToken), authenticated: isAdmin(req) });
});

adminRouter.post('/login', (req, res) => {
  if (!adminToken) return res.status(404).json({ error: 'Admin panel is disabled' });
  const token = req.body?.token;
  if (typeof token !== 'string' || !safeEqual(token, adminToken)) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const expires = String(Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', sessionCookie(req, `${expires}.${sign(expires)}`, SESSION_MS / 1000));
  res.json({ authenticated: true });
});

adminRouter.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ authenticated: false });
});

module.exports = { isAdmin, adminRouter, adminEnabled: Boolean(adminToken) };
