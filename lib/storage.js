'use strict';

const archiver = require('archiver');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  s3, BUCKET, getSignedUrl,
  ListObjectsV2Command, GetObjectCommand, PutObjectCommand,
  DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand
} = require('./s3');
const { cleanPath, joinPath, baseName, parentPath, mimeFromName } = require('./util');

const TRASH_PREFIX = '.trash';
const SHARE_DIR = '.shares';
const HIDDEN_ROOTS = new Set([TRASH_PREFIX, SHARE_DIR]);

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

async function listAll(prefix, { max } = {}) {
  const out = [];
  let token;
  do {
    const cmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token });
    const res = await s3.send(cmd);
    for (const c of res.Contents || []) out.push(c);
    if (max && out.length >= max) break;
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function listDir(dir) {
  const prefix = dir ? cleanPath(dir) + '/' : '';
  const folders = [];
  const files = [];
  let token;
  do {
    const cmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: '/', ContinuationToken: token });
    const res = await s3.send(cmd);
    for (const cp of res.CommonPrefixes || []) {
      const p = cp.Prefix;
      const name = p.endsWith('/') ? p.slice(0, -1).split('/').pop() : p.split('/').pop();
      // hide internal dirs (.trash / .shares) from normal browsing at the root
      if (dir === '' && HIDDEN_ROOTS.has(name)) continue;
      folders.push({ name, type: 'folder' });
    }
    for (const c of res.Contents || []) {
      if (c.Key === prefix) continue; // zero-byte folder placeholder
      // A key that is itself a folder placeholder under a different name is excluded by delimiter.
      // Skip any key whose last segment equals the scanned prefix (shouldn't happen).
      const name = c.Key.split('/').pop();
      if (dir === '' && HIDDEN_ROOTS.has(name)) continue;
      files.push({ name, type: 'file', size: c.Size, lastModified: c.LastModified, key: c.Key });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return { path: dir || '', folders, files };
}

// ---------------------------------------------------------------------------
// Write ops
// ---------------------------------------------------------------------------

async function mkdir(dir) {
  const key = dir ? cleanPath(dir) + '/' : '';
  if (!key) throw new Error('不能在此目录创建文件夹');
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: '' }));
  return key;
}

async function upload(prefix, filename, stream, contentType, contentLength) {
  const key = joinPath(prefix, filename);
  const params = { Bucket: BUCKET, Key: key, Body: stream, ContentType: contentType || mimeFromName(filename) };
  if (contentLength) params.ContentLength = contentLength;
  await s3.send(new PutObjectCommand(params));
  return key;
}

// ---------------------------------------------------------------------------
// Object helpers
// ---------------------------------------------------------------------------

async function getObject(key) {
  return s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function head(key) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    return null;
  }
}

async function copyObject(srcKey, dstKey) {
  try {
    // Path-style compatible copy. Encode key segments but keep the bucket/key slash literal.
    const CopySource = `${BUCKET}/${srcKey.split('/').map(encodeURIComponent).join('/')}`;
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: dstKey, CopySource }));
  } catch (e) {
    // Fallback: stream copy (avoids CopySource-format differences between providers).
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: srcKey }));
    const params = { Bucket: BUCKET, Key: dstKey, Body: got.Body, ContentType: got.ContentType };
    if (got.ContentLength) params.ContentLength = got.ContentLength;
    await s3.send(new PutObjectCommand(params));
  }
}

async function deleteKeys(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  // Delete one object at a time. The batched DeleteObjects op requires a
  // Content-MD5 header that some S3-compatible providers (RainS3) reject unless
  // explicitly present, so per-object deletes are the reliable path.
  for (const k of unique) {
    if (!k) continue;
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }));
  }
}

// Permanently remove a file or folder (including folder placeholders).
async function hardDelete(key) {
  const s = cleanPath(key);
  if (!s) throw new Error('无效路径');
  const children = await listAll(s + '/');
  const toDelete = children.map(c => c.Key);
  toDelete.push(s, s + '/');
  await deleteKeys(toDelete);
}

// Move a "path" (file or folder) to another "path". Preserves folder structure.
async function movePath(src, dst) {
  const s = cleanPath(src);
  const d = cleanPath(dst);
  if (!s || !d) throw new Error('无效路径');
  if (s === d) return;

  const children = await listAll(s + '/');
  if (children.length > 0) {
    // source is a folder (has children under s/)
    const seg = (s + '/').length;
    for (const c of children) {
      if (c.Key === s + '/') {
        await copyObject(c.Key, d + '/');
      } else {
        await copyObject(c.Key, d + '/' + c.Key.slice(seg));
      }
    }
    await deleteKeys(children.map(c => c.Key));
  } else {
    // single object (file)
    await copyObject(s, d);
    await deleteKeys([s]);
  }
  return d;
}

// Rename = move within the same parent.
async function rename(path, newName) {
  const s = cleanPath(path);
  const n = cleanPath(newName);
  if (!s || !n) throw new Error('无效名称');
  const parent = parentPath(s);
  const dst = parent ? parent + '/' + n : n;
  return movePath(s, dst);
}

// ---------------------------------------------------------------------------
// Trash / recycle bin
// ---------------------------------------------------------------------------

async function trashPath(path) {
  const key = cleanPath(path);
  if (!key) throw new Error('不能删除根目录');
  const ts = Date.now();
  const dest = `${TRASH_PREFIX}/${ts}/${key}`;
  await movePath(key, dest);
  return dest;
}

// Compute the original path that a trash group represents.
async function trashGroupPath(ts) {
  const base = `${TRASH_PREFIX}/${ts}/`;
  const objs = await listAll(base);
  const rels = objs.map(o => o.Key.slice(base.length));
  if (!rels.length) return null;
  if (rels.length === 1) return cleanPath(rels[0]); // a single item (file or empty-folder placeholder)
  // Multiple objects => they share a folder prefix; return that folder path.
  let common = rels[0].split('/')[0];
  const parts = rels[0].split('/');
  for (let i = 1; i < parts.length; i++) {
    const pref = parts.slice(0, i).join('/');
    if (rels.every(r => r.startsWith(pref + '/'))) common = pref;
    else break;
  }
  return cleanPath(common);
}

async function trashList() {
  const groups = (await listDir(TRASH_PREFIX)).folders;
  const result = [];
  for (const g of groups) {
    const path = await trashGroupPath(g.name);
    result.push({ ts: g.name, path: path || g.name });
  }
  return result;
}

async function restoreTrash(ts) {
  const path = await trashGroupPath(ts);
  if (!path) throw new Error('回收站条目为空');
  const src = `${TRASH_PREFIX}/${ts}/${path}`;
  // If the target already exists, append a timestamp suffix to avoid clobbering.
  let target = path;
  const existing = await head(path);
  if (existing) {
    const p = parentPath(path);
    const b = baseName(path);
    const suffix = '-' + Date.now().toString(36);
    target = p ? p + '/' + b + suffix : b + suffix;
  }
  await movePath(src, target);
  return target;
}

async function deleteTrashGroup(ts) {
  const base = `${TRASH_PREFIX}/${ts}/`;
  const objs = await listAll(base);
  await deleteKeys(objs.map(o => o.Key));
}

async function emptyTrash() {
  const objs = await listAll(`${TRASH_PREFIX}/`);
  await deleteKeys(objs.map(o => o.Key));
}

// ---------------------------------------------------------------------------
// Download / zip / share / search / usage
// ---------------------------------------------------------------------------

async function zipDownload(prefix, res, log) {
  const base = prefix ? cleanPath(prefix) + '/' : '';
  const objects = await listAll(base);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { if (log) log('zip error: ' + err.message); });
  const name = prefix ? baseName(prefix) : 'download';
  res.attachment(`${name}.zip`);
  archive.pipe(res);
  for (const obj of objects) {
    if (obj.Key === base) continue; // skip folder placeholder
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    const rel = obj.Key.slice(base.length);
    archive.append(got.Body, { name: rel });
  }
  await archive.finalize();
}

async function presign(key, expiresSec) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresSec });
}

// Share a FOLDER by streaming it into a temporary zip object in the bucket, then
// presigning that object so the link is publicly downloadable (like a file share).
// Returns { url, expires, key }.
async function createZipShare(prefix, expiresSec) {
  const base = prefix ? cleanPath(prefix) + '/' : '';
  const name = (prefix ? baseName(prefix) : 'share') + '-' + Date.now().toString(36);
  const expiresEpoch = Date.now() + expiresSec * 1000;
  const zipKey = `${SHARE_DIR}/${expiresEpoch}/${name}.zip`;

  const objects = await listAll(base);
  const tmp = path.join(os.tmpdir(), `${name}.zip`);
  try {
    // Write the zip to a temp file so we can stream it to S3 with a known length.
    await new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });
      const out = fs.createWriteStream(tmp);
      archive.on('error', reject);
      out.on('error', reject);
      out.on('close', resolve);
      archive.pipe(out);
      (async () => {
        try {
          for (const obj of objects) {
            if (obj.Key === base) continue; // skip folder placeholder
            const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
            const rel = obj.Key.slice(base.length);
            archive.append(got.Body, { name: rel });
          }
          await archive.finalize();
        } catch (e) { reject(e); }
      })();
    });
    const stat = fs.statSync(tmp);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: zipKey, Body: fs.createReadStream(tmp),
      ContentLength: stat.size, ContentType: 'application/zip'
    }));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
  const url = await presign(zipKey, expiresSec);
  return { url, expires: expiresSec, key: zipKey };
}

// Remove temporary share-zip objects whose link has already expired.
async function cleanupShares() {
  const groups = (await listDir(SHARE_DIR)).folders; // each group is an expiry epoch (ms)
  const now = Date.now();
  for (const g of groups) {
    const ts = Number(g.name);
    if (!isNaN(ts) && ts < now) {
      const objs = await listAll(`${SHARE_DIR}/${g.name}/`);
      await deleteKeys(objs.map(o => o.Key));
    }
  }
}

async function search(q) {
  const all = await listAll('', { max: 20000 });
  const query = String(q || '').toLowerCase();
  return all
    .filter(o => !o.Key.endsWith('/') && o.Key.toLowerCase().includes(query))
    .slice(0, 500);
}

async function usage() {
  const all = await listAll('', { max: 100000 });
  let size = 0;
  for (const o of all) size += (o.Size || 0);
  return { size, count: all.length, truncated: all.length >= 100000 };
}

module.exports = {
  cleanPath, joinPath, baseName, parentPath, TRASH_PREFIX, SHARE_DIR,
  listDir, listAll, mkdir, upload, getObject, head,
  copyObject, deleteKeys, movePath, rename, hardDelete,
  trashPath, trashList, restoreTrash, deleteTrashGroup, emptyTrash,
  zipDownload, presign, createZipShare, cleanupShares, search, usage
};
