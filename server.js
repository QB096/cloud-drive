'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { router } = require('./routes/api');
const storage = require('./lib/storage');

const app = express();
const PORT = Number(process.env.PORT) || 8080;
// Local-only by default. Set HOST=0.0.0.0 in .env to expose on your LAN / phone
// (strongly recommend also setting APP_PASSWORD if you do).
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api', router);

app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, HOST, () => {
  console.log('=========================================');
  console.log('  Rain Drive - 你的对象存储云盘');
  console.log('=========================================');
  console.log(`  访问地址   : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  桶 (bucket): ${process.env.S3_BUCKET || 'qb01'}`);
  console.log(`  Endpoint   : ${process.env.S3_ENDPOINT || 'https://cn-nb1.rains3.com'}`);
  console.log(`  登录口令   : ${process.env.APP_PASSWORD ? '已设置' : '未设置（本地模式）'}`);
  console.log('=========================================');

  // Periodic cleanup of expired temporary share-zip objects.
  storage.cleanupShares().catch(() => {});
  setInterval(() => { storage.cleanupShares().catch(() => {}); }, 60 * 60 * 1000);
});
