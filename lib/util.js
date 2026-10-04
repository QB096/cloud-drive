'use strict';

// Small path + mime helpers for treating an S3 bucket like a filesystem.

function cleanPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function joinPath(dir, name) {
  const d = cleanPath(dir);
  const n = cleanPath(name);
  if (!d) return n;
  if (!n) return d;
  return d + '/' + n;
}

function baseName(p) {
  const c = cleanPath(p);
  const i = c.lastIndexOf('/');
  return i === -1 ? c : c.slice(i + 1);
}

function parentPath(p) {
  const c = cleanPath(p);
  const i = c.lastIndexOf('/');
  return i === -1 ? '' : c.slice(0, i);
}

// Conservative, widely-known mime map (ext -> mime).
const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
  mjs: 'text/javascript', json: 'application/json', xml: 'application/xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', log: 'text/plain',
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', m4v: 'video/x-m4v',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  epub: 'application/epub+zip', apk: 'application/vnd.android.package-archive'
};

function mimeFromName(name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// Textual formats that can be previewed inline as text.
const TEXT_EXTS = new Set(['txt', 'md', 'json', 'xml', 'csv', 'log', 'js', 'ts', 'css', 'html', 'htm', 'yml', 'yaml', 'ini', 'conf', 'sh', 'py', 'go', 'c', 'h', 'java', 'rs', 'sql', 'env', 'gitignore', 'properties']);

function isTextName(name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  return TEXT_EXTS.has(ext) || /\.(txt|md)$/i.test(name);
}

// Image formats for inline preview.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);
function isImageName(name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  return IMAGE_EXTS.has(ext);
}

// Video / audio that can be played inline.
const MEDIA_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov', 'mkv', 'm4v', 'avi', 'mp3', 'wav', 'm4a', 'flac', 'aac']);
function isMediaName(name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  return MEDIA_EXTS.has(ext);
}

function formatBytes(n) {
  if (n == null || n === '') return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

function formatDate(d) {
  if (!d) return '-';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '-';
    return dt.toLocaleString('zh-CN', { hour12: false });
  } catch (e) {
    return '-';
  }
}

module.exports = {
  cleanPath, joinPath, baseName, parentPath,
  mimeFromName, isTextName, isImageName, isMediaName,
  formatBytes, formatDate
};
