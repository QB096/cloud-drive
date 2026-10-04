'use strict';

const express = require('express');
const crypto = require('crypto');
const storage = require('../lib/storage');
const { BUCKET } = require('../lib/s3');
const { cleanPath, baseName, mimeFromName, formatBytes } = require('../lib/util');

const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SHARE_EXPIRES = Number(process.env.SHARE_EXPIRES) || 604800;
// SigV4 presigned URLs are capped at 7 days (604800s) by AWS-style signing.
const MAX_SHARE = 604800;
function clampExpires(n) {
  const v = Number(n) || SHARE_EXPIRES;
  return Math.max(60, Math.min(v, MAX_SHARE));
}

// In-memory session store (fine for a personal, single-instance drive).
const sessions = new Set();

function cookieToken(req) {
  return req.cookies ? req.cookies.session : undefined;
}

function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  const t = cookieToken(req);
  return !!t && sessions.has(t);
}

function authRequired(req, res, next) {
  if (!APP_PASSWORD) return next();
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

const router = express.Router();

// Wrap async handlers so thrown/rejected errors become 500 JSON.
const wrap = fn => (req, res) =>
  Promise.resolve(fn(req, res)).catch(err => {
    const msg = (err && err.message) ? err.message : 'internal error';
    res.status(err && err.name === 'NotFound' ? 404 : 500).json({ error: msg });
  });

// ---------------------------------------------------------------------------
// Auth (public unless a password is required)
// ---------------------------------------------------------------------------
router.post('/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true, authed: true });
  const { password } = req.body || {};
  if (password === APP_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    return res.json({ ok: true, authed: true });
  }
  return res.status(401).json({ error: '密码错误' });
});

router.get('/session', (req, res) => {
  res.json({ authed: isAuthed(req), passwordSet: !!APP_PASSWORD });
});

router.get('/config', (req, res) => {
  res.json({
    appName: process.env.APP_NAME || '我的云盘',
    bucket: BUCKET,
    passwordSet: !!APP_PASSWORD,
    authed: isAuthed(req)
  });
});

router.post('/logout', (req, res) => {
  const t = cookieToken(req);
  if (t) sessions.delete(t);
  res.clearCookie('session');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------
router.get('/list', authRequired, wrap(async (req, res) => {
  const path = cleanPath(req.query.path || '');
  const data = await storage.listDir(path);
  res.json(data);
}));

router.get('/search', authRequired, wrap(async (req, res) => {
  const results = await storage.search(req.query.q || '');
  res.json(results);
}));

router.get('/usage', authRequired, wrap(async (req, res) => {
  const u = await storage.usage();
  res.json({ ...u, human: formatBytes(u.size) });
}));

router.post('/mkdir', authRequired, wrap(async (req, res) => {
  const path = cleanPath((req.body || {}).path || '');
  if (!path) return res.status(400).json({ error: '缺少目录名' });
  const key = await storage.mkdir(path);
  res.json({ ok: true, key });
}));

// ---------------------------------------------------------------------------
// Upload (raw stream body: PUT /api/upload?path=<dir>&filename=<name>)
// ---------------------------------------------------------------------------
router.put('/upload', authRequired, wrap(async (req, res) => {
  const dir = cleanPath(req.query.path || '');
  const filename = req.query.filename || req.headers['x-filename'];
  if (!filename) return res.status(400).json({ error: '缺少文件名' });
  const contentType = req.headers['content-type'] || mimeFromName(filename);
  const contentLength = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined;
  const key = await storage.upload(dir, filename, req, contentType, contentLength);
  res.json({ ok: true, key });
}));

// ---------------------------------------------------------------------------
// Download / preview
// ---------------------------------------------------------------------------
router.get('/download', authRequired, wrap(async (req, res) => {
  const path = cleanPath(req.query.path || '');
  if (!path) return res.status(400).json({ error: '缺少路径' });
  const got = await storage.getObject(path);
  const name = baseName(path);
  res.setHeader('Content-Type', got.ContentType || 'application/octet-stream');
  if (got.ContentLength != null) res.setHeader('Content-Length', got.ContentLength);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  got.Body.pipe(res);
}));

router.get('/preview', authRequired, wrap(async (req, res) => {
  const path = cleanPath(req.query.path || '');
  if (!path) return res.status(400).json({ error: '缺少路径' });
  const got = await storage.getObject(path);
  const name = baseName(path);
  res.setHeader('Content-Type', got.ContentType || 'application/octet-stream');
  if (got.ContentLength != null) res.setHeader('Content-Length', got.ContentLength);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  got.Body.pipe(res);
}));

router.get('/download-zip', authRequired, wrap(async (req, res) => {
  const path = cleanPath(req.query.path || '');
  await storage.zipDownload(path, res, msg => console.log(msg));
}));

// ---------------------------------------------------------------------------
// Rename / move / delete / trash
// ---------------------------------------------------------------------------
router.post('/rename', authRequired, wrap(async (req, res) => {
  const { path, newName } = req.body || {};
  if (!path || !newName) return res.status(400).json({ error: '缺少参数' });
  const key = await storage.rename(path, newName);
  res.json({ ok: true, key });
}));

router.post('/move', authRequired, wrap(async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: '缺少参数' });
  const key = await storage.movePath(from, to);
  res.json({ ok: true, key });
}));

router.post('/trash', authRequired, wrap(async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ error: '缺少参数' });
  const key = await storage.trashPath(path);
  res.json({ ok: true, key });
}));

router.get('/trash', authRequired, wrap(async (req, res) => {
  const list = await storage.trashList();
  res.json(list);
}));

router.post('/trash/restore', authRequired, wrap(async (req, res) => {
  const { ts } = req.body || {};
  if (!ts) return res.status(400).json({ error: '缺少参数' });
  const target = await storage.restoreTrash(ts);
  res.json({ ok: true, target });
}));

router.post('/trash/delete', authRequired, wrap(async (req, res) => {
  const { ts } = req.body || {};
  if (!ts) return res.status(400).json({ error: '缺少参数' });
  await storage.deleteTrashGroup(ts);
  res.json({ ok: true });
}));

router.post('/trash/empty', authRequired, wrap(async (req, res) => {
  await storage.emptyTrash();
  res.json({ ok: true });
}));

router.post('/delete', authRequired, wrap(async (req, res) => {
  // Hard delete (permanent remove of a file or folder).
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: '缺少参数' });
  await storage.hardDelete(key);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------
router.get('/share', authRequired, wrap(async (req, res) => {
  const path = cleanPath(req.query.path || '');
  if (!path) return res.status(400).json({ error: '缺少路径' });
  const expires = clampExpires(req.query.expires);
  const url = await storage.presign(path, expires);
  res.json({ url, expires });
}));

// Share a folder via a temporary zip object (configurable expiry, auto-cleaned).
router.post('/share-zip', authRequired, wrap(async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ error: '缺少路径' });
  const expires = clampExpires((req.body || {}).expires);
  const result = await storage.createZipShare(path, expires);
  res.json(result);
}));

module.exports = { router, isAuthed };
