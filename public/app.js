'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function iconFor(item) {
  if (item.type === 'folder') return '📁';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (['png','jpg','jpeg','gif','svg','webp','bmp','ico'].includes(ext)) return '🖼️';
  if (['mp4','webm','ogg','mov','mkv','m4v','avi'].includes(ext)) return '🎬';
  if (['mp3','wav','m4a','flac','aac'].includes(ext)) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['zip','gz','tar','7z','rar'].includes(ext)) return '🗜️';
  if (['doc','docx'].includes(ext)) return '📘';
  if (['xls','xlsx','csv'].includes(ext)) return '📊';
  if (['ppt','pptx'].includes(ext)) return '📙';
  if (['txt','md','json','xml','js','ts','css','sh','py','go','java','c','h','sql','yml','yaml','ini'].includes(ext)) return '📝';
  return '📄';
}
const isImage = n => ['png','jpg','jpeg','gif','webp','bmp','ico'].includes((n.split('.').pop()||'').toLowerCase());
const isMedia = n => ['mp4','webm','ogg','mov','mkv','m4v','avi','mp3','wav','m4a','flac','aac'].includes((n.split('.').pop()||'').toLowerCase());

function toast(msg, type = '') {
  const t = el('div', 'toast ' + type, msg);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) { showLogin(); const d = await res.json().catch(() => ({})); throw new Error(d.error || '未登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  cwd: '',          // current file path ('' = root)
  trash: false,     // viewing trash
  searchQ: '',
  selectedKey: null,
  clipboard: null,  // { mode:'move', key, name }
  cfg: { appName: '我的云盘', bucket: '', passwordSet: false }
};

// ---------------------------------------------------------------------------
// Loading / rendering
// ---------------------------------------------------------------------------
async function refresh() {
  if (state.searchQ) { await renderSearch(); return; }
  updateBreadcrumb();
  const data = await api('/list?path=' + encodeURIComponent(state.cwd));
  state.entries = data;
  renderList(data);
  loadUsage();
}

async function loadUsage() {
  try {
    const u = await api('/usage');
    $('#usage').textContent = `${u.human} · ${u.count} 项`;
  } catch (e) { /* ignore */ }
}

function updateBreadcrumb() {
  const bc = $('#breadcrumb');
  bc.innerHTML = '';
  const parts = state.cwd ? state.cwd.split('/') : [];
  const mk = (label, path, cur) => {
    const c = el('span', 'crumb' + (cur ? ' current' : ''), label);
    if (!cur) c.onclick = () => { state.cwd = path; refresh(); };
    bc.appendChild(c);
  };
  mk('🖥 全部文件', '', parts.length === 0);
  let p = '';
  parts.forEach((seg, i) => {
    bc.appendChild(el('span', 'crumb-sep', '›'));
    p = p ? p + '/' + seg : seg;
    mk(seg, p, i === parts.length - 1);
  });
}

function renderList(data) {
  const list = $('#file-list');
  list.innerHTML = '';
  $('#empty').classList.toggle('hidden', data.folders.length + data.files.length > 0);
  [$('#trash-bar')].forEach(x => x && x.classList.add('hidden'));

  const all = [...data.folders.map(f => ({ ...f, isDir: true })), ...data.files.map(f => ({ ...f, isDir: false }))];
  all.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1));

  for (const item of all) list.appendChild(makeRow(item));
}

function makeRow(item) {
  const row = el('div', 'row ' + (item.isDir ? 'folder' : 'file'));
  row.dataset.key = item.key || item.name;

  // name cell
  const nameCell = el('div', 'col-name');
  if (item.isDir) {
    nameCell.appendChild(el('span', 'file-icon', '📁'));
  } else if (isImage(item.name)) {
    const img = el('img', 'thumb');
    img.loading = 'lazy';
    img.src = '/api/preview?path=' + encodeURIComponent(state.cwd ? state.cwd + '/' + item.name : item.name);
    img.onerror = () => { img.remove(); nameCell.insertBefore(el('span', 'file-icon', iconFor(item)), nameCell.firstChild); };
    nameCell.appendChild(img);
  } else {
    nameCell.appendChild(el('span', 'file-icon', iconFor(item)));
  }
  const nm = el('div', 'file-name', item.name);
  nm.title = item.name;
  nameCell.appendChild(nm);
  row.appendChild(nameCell);

  // size
  row.appendChild(el('div', 'col-size', item.isDir ? '-' : fmtSize(item.size)));
  // date
  row.appendChild(el('div', 'col-date', item.isDir ? '-' : fmtDate(item.lastModified)));

  // actions
  const actions = el('div', 'col-actions');
  actions.appendChild(actionBtn(item.isDir ? '打开' : '预览', () => openItem(item, true)));
  if (!item.isDir) actions.appendChild(actionBtn('⤓', () => downloadFile(item)));
  actions.appendChild(actionBtn('分享', () => shareItem(item)));
  if (item.isDir) actions.appendChild(actionBtn('⬇ 压缩', () => downloadZip(item)));
  actions.appendChild(actionBtn('重命名', () => renameItem(item)));
  actions.appendChild(actionBtn('移动', () => moveItem(item)));
  const del = actionBtn('删除', () => trashItem(item)); del.classList.add('del');
  actions.appendChild(del);
  row.appendChild(actions);

  row.onclick = e => {
    if (e.target.closest('button')) return;
    openItem(item, false);
  };
  row.oncontextmenu = e => { e.preventDefault(); openCtx(e, item); };
  return row;
}

function actionBtn(label, fn) {
  const b = el('button', '', label);
  b.onclick = e => { e.stopPropagation(); fn(); };
  return b;
}

const fmtSize = n => { const u=['B','KB','MB','GB','TB']; let v=+n||0,i=0; while(v>=1024&&i<u.length-1){v/=1024;i++;} return (i? v.toFixed(1):v)+' '+u[i]; };
const fmtDate = d => { if(!d) return '-'; try { const x=new Date(d); return isNaN(x)? '-': x.toLocaleString('zh-CN',{hour12:false}); } catch(e){ return '-'; } };

function openItem(item, preview) {
  if (item.isDir) {
    if (preview) return downloadZip(item);
    state.cwd = state.cwd ? state.cwd + '/' + item.name : item.name;
    refresh();
  } else {
    if (preview) previewFile(item);
    else downloadFile(item);
  }
}

function downloadFile(item) {
  const path = state.cwd ? state.cwd + '/' + item.name : item.name;
  const a = el('a'); a.href = '/api/download?path=' + encodeURIComponent(path); a.download = item.name;
  document.body.appendChild(a); a.click(); a.remove();
}

function downloadZip(item) {
  const path = state.cwd ? state.cwd + '/' + item.name : item.name;
  const a = el('a'); a.href = '/api/download-zip?path=' + encodeURIComponent(path); a.download = item.name + '.zip';
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
function setProgress(show, label, frac) {
  const pb = $('#progress-bar');
  pb.classList.toggle('hidden', !show);
  if (show) {
    $('#progress-fill').style.width = Math.round((frac || 0) * 100) + '%';
    $('#progress-label').textContent = label;
  }
}

function uploadOne(file, rel) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/upload?path=' + encodeURIComponent(state.cwd) + '&filename=' + encodeURIComponent(rel));
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    const total = file.size || 0;
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(true, '上传中：' + file.name, e.loaded / e.total); };
    xhr.onload = () => { setProgress(false); if (xhr.status >= 200 && xhr.status < 300) resolve(); else { let m='上传失败'; try { m = JSON.parse(xhr.responseText).error || m; } catch(_){} reject(new Error(m)); } };
    xhr.onerror = () => { setProgress(false); reject(new Error('网络错误')); };
    xhr.send(file);
  });
}

async function uploadFiles(files, dir) {
  if (!files.length) return;
  let ok = 0, err = 0;
  for (const f of files) {
    try { await uploadOne(f, f.name); ok++; }
    catch (e) { err++; toast(e.message, 'err'); }
  }
  if (ok) toast(`上传完成：${ok} 个文件`, 'ok');
  refresh();
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function modal(html) {
  const overlay = el('div', 'overlay');
  const m = el('div', 'modal');
  m.innerHTML = html;
  overlay.appendChild(m);
  overlay.onclick = e => { if (e.target === overlay) close(); };
  function close() { overlay.remove(); }
  const mroot = $('#modal-root');
  mroot.appendChild(overlay);
  return { overlay, m, close };
}

function promptModal(title, label, value, okText) {
  return new Promise(res => {
    const { m, close } = modal(`<h3></h3><p></p><input autofocus><div class="modal-actions"><button class="ghost cancel">取消</button><button class="primary ok"></button></div>`);
    $('h3', m).textContent = title;
    $('p', m).textContent = label || '';
    const inp = $('input', m);
    inp.value = value || '';
    $('.ok', m).textContent = okText || '确定';
    $('.cancel', m).onclick = close;
    m.querySelectorAll('button.ok').forEach(b => b.onclick = () => { res(inp.value.trim()); close(); });
    inp.onkeydown = e => { if (e.key === 'Enter') { res(inp.value.trim()); close(); } };
    inp.focus();
    if (value) { const i = value.lastIndexOf('.'); inp.setSelectionRange(0, i > 0 ? i : value.length); }
  });
}

function confirmModal(title, text, okText, danger) {
  return new Promise(res => {
    const { m, close } = modal(`<h3></h3><p></p><div class="modal-actions"><button class="ghost cancel">取消</button><button class="primary ok"></button></div>`);
    $('h3', m).textContent = title;
    $('p', m).textContent = text || '';
    const ok = $('.ok', m); ok.textContent = okText || '确定'; if (danger) ok.classList.add('danger');
    $('.cancel', m).onclick = () => { res(false); close(); };
    ok.onclick = () => { res(true); close(); };
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function newFolder() {
  const name = await promptModal('新建文件夹', '请输入文件夹名称', '新建文件夹');
  if (!name) return;
  const p = state.cwd ? state.cwd + '/' + name : name;
  await api('/mkdir', { method: 'POST', body: { path: p } });
  toast('已创建「' + name + '」', 'ok');
  refresh();
}

async function renameItem(item) {
  const path = state.cwd ? state.cwd + '/' + item.name : item.name;
  const newName = await promptModal('重命名', '输入新名称：', item.name);
  if (!newName || newName === item.name) return;
  await api('/rename', { method: 'POST', body: { path, newName } });
  toast('重命名成功', 'ok');
  refresh();
}

async function moveItem(item) {
  const path = state.cwd ? state.cwd + '/' + item.name : item.name;
  const target = await promptModal('移动到', '输入目标文件夹（留空=根目录）：', '/');
  if (target == null) return;
  let t = String(target).replace(/^\//, '');
  const res = await api('/move', { method: 'POST', body: { from: path, to: t } });
  toast('已移动到', 'ok');
  refresh();
}

async function trashItem(item) {
  const path = state.cwd ? state.cwd + '/' + item.name : item.name;
  const ok = await confirmModal('移到回收站', `确定将「${item.name}」移到回收站吗？`, '移到回收站', true);
  if (!ok) return;
  await api('/trash', { method: 'POST', body: { path } });
  toast('已移入回收站', 'ok');
  refresh();
}

const SHARE_OPTIONS = [
  { label: '1 小时', value: 3600 },
  { label: '1 天', value: 86400 },
  { label: '3 天', value: 259200 },
  { label: '7 天', value: 604800 }
];

async function shareItem(item) {
  const path = state.cwd ? state.cwd + '/' + item.name : item.name;
  const { m, close } = modal(`<h3>分享「${escapeHtml(item.name)}」</h3>
    <p>${item.isDir ? '将以压缩包（zip）形式分享整个文件夹。' : '生成临时签名链接，任何拿到链接的人都能下载（无需登录）。'}</p>
    <div class="exp-row"><label>有效时长</label><select class="share-exp"></select></div>
    <div class="share-link"><input readonly placeholder="生成中…"><button class="primary gen">生成</button><button class="copy" disabled>复制</button></div>
    <div class="share-hint"></div>
    <div class="modal-actions"><button class="ghost close">关闭</button></div>`);
  const sel = $('.share-exp', m);
  SHARE_OPTIONS.forEach(o => { const opt = el('option'); opt.value = o.value; opt.textContent = o.label; sel.appendChild(opt); });
  sel.value = 604800;
  const inp = $('.share-link input', m);
  const genBtn = $('.share-link .gen', m);
  const copyBtn = $('.share-link .copy', m);
  const hint = $('.share-hint', m);
  $('.close', m).onclick = close;

  async function generate() {
    const expires = Number(sel.value);
    try {
      genBtn.disabled = true; genBtn.textContent = '生成中…';
      let data;
      if (item.isDir) data = await api('/share-zip', { method: 'POST', body: { path, expires } });
      else data = await api('/share?path=' + encodeURIComponent(path) + '&expires=' + expires);
      inp.value = data.url; copyBtn.disabled = false;
      const human = (SHARE_OPTIONS.find(o => o.value === expires) || {}).label || (expires / 3600 + ' 小时');
      hint.textContent = `${item.isDir ? 'zip 下载链接' : '下载链接'} · ${human}内有效`;
      inp.select();
    } catch (e) { toast(e.message, 'err'); }
    finally { genBtn.disabled = false; genBtn.textContent = '生成'; }
  }
  genBtn.onclick = generate;
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(inp.value); toast('已复制', 'ok'); } catch (e) { inp.select(); document.execCommand('copy'); toast('已复制', 'ok'); } };
  generate();
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
async function previewFile(item) {
  const path = state.cwd ? state.cwd + '/' + item.name : item.name;
  const p = '/api/preview?path=' + encodeURIComponent(path);
  const { m, close } = modal(`<h3></h3><div class="preview-body"></div><div class="modal-actions"><button class="ghost close">关闭</button><button class="primary dl">下载</button></div>`);
  $('h3', m).textContent = item.name;
  const body = $('.preview-body', m);
  $('.close', m).onclick = close;
  $('.dl', m).onclick = () => { const a = el('a'); a.href = p; a.download = item.name; a.click(); };

  if (isImage(item.name)) {
    const img = el('img'); img.src = p; body.appendChild(img);
  } else if (isMedia(item.name)) {
    const v = el('video'); v.controls = true; v.src = p; body.appendChild(v);
  } else if (item.name.toLowerCase().endsWith('.pdf')) {
    const f = el('iframe'); f.src = p; f.style.cssText = 'width:100%;height:60vh;border:none'; body.appendChild(f);
  } else {
    // treat as text
    try {
      const r = await fetch(p, { credentials: 'same-origin' });
      const text = await r.text();
      const pre = el('pre', '', text.length > 200000 ? text.slice(0, 200000) + '\n\n…（内容过长已截断）' : text);
      body.appendChild(pre);
    } catch (e) {
      toast('无法预览文本', 'err');
    }
  }
}

// ---------------------------------------------------------------------------
// Trash view
// ---------------------------------------------------------------------------
async function showTrash() {
  state.trash = true; state.searchQ = '';
  $('#search-input').value = ''; $('#search-clear').classList.add('hidden');
  $('#trash-bar').classList.remove('hidden');
  const list = $('#file-list'); list.innerHTML = '';
  $('#empty').classList.add('hidden');
  const items = await api('/trash');
  if (!items.length) { $('#empty').textContent = '回收站为空'; $('#empty').classList.remove('hidden'); }
  const sorted = items.sort((a, b) => b.ts - a.ts);
  for (const it of sorted) {
    const row = el('div', 'row folder');
    row.appendChild(el('div', 'col-name')).appendChild(el('span', 'file-name', it.path));
    const rowName = row.querySelector('.col-name');
    rowName.insertBefore(el('span', 'file-icon', '🗑'), rowName.firstChild);
    row.appendChild(el('div', 'col-size', ''));
    row.appendChild(el('div', 'col-date', fmtDate(new Date(+it.ts))));
    const actions = el('div', 'col-actions');
    const r = el('button', '', '恢复'); r.onclick = e => { e.stopPropagation(); restoreTrash(it.ts); };
    const d = el('button', '', '彻底删除'); d.classList.add('del'); d.onclick = e => { e.stopPropagation(); deleteTrash(it.ts); };
    actions.appendChild(r); actions.appendChild(d);
    row.appendChild(actions);
    list.appendChild(row);
  }
  const head = $('#list-head'); head.classList.remove('hidden');
  // hide normal toolbar actions? keep.
  return;
}

async function restoreTrash(ts) {
  await api('/trash/restore', { method: 'POST', body: { ts } });
  toast('已恢复', 'ok');
  showTrash();
}
async function deleteTrash(ts) {
  const ok = await confirmModal('彻底删除', '删除后不可恢复，确定吗？', '彻底删除', true);
  if (!ok) return;
  await api('/trash/delete', { method: 'POST', body: { ts } });
  toast('已删除', 'ok');
  showTrash();
}
async function emptyTrash() {
  const ok = await confirmModal('清空回收站', '将永久删除回收站中的所有文件，此操作不可恢复。', '清空', true);
  if (!ok) return;
  await api('/trash/empty', { method: 'POST', body: {} });
  toast('回收站已清空', 'ok');
  showTrash();
}

function showMain() {
  state.trash = false;
  $('#trash-bar').classList.add('hidden');
  $('#list-head').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
async function renderSearch() {
  updateBreadcrumb();
  $('#list-head').classList.remove('hidden');
  const list = $('#file-list'); list.innerHTML = '';
  $('#empty').classList.add('hidden');
  const q = state.searchQ.toLowerCase();
  const results = await api('/search?q=' + encodeURIComponent(q));
  const files = results.filter(o => !o.Key.endsWith('/'));
  if (!files.length) { $('#empty').textContent = '未找到匹配的文件'; $('#empty').classList.remove('hidden'); return; }
  for (const f of files) {
    const name = f.Key.split('/').pop();
    const dir = f.Key.slice(0, -name.length).replace(/\/$/, '');
    const row = el('div', 'row file');
    row.appendChild(el('div', 'col-name')).appendChild(el('span', 'file-name', f.Key));
    const rn = row.querySelector('.col-name');
    rn.insertBefore(el('span', 'file-icon', iconFor(name)), rn.firstChild);
    row.appendChild(el('div', 'col-size', fmtSize(f.Size)));
    row.appendChild(el('div', 'col-date', fmtDate(f.LastModified)));
    const actions = el('div', 'col-actions');
    const d = el('button', '', '下载'); d.onclick = e => { e.stopPropagation(); const a = el('a'); a.href = '/api/download?path=' + encodeURIComponent(f.Key); a.download = name; a.click(); };
    const v = el('button', '', '预览'); v.onclick = e => { e.stopPropagation(); previewByKey(f.Key, name); };
    actions.appendChild(v); actions.appendChild(d);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function previewByKey(key, name) {
  const p = '/api/preview?path=' + encodeURIComponent(key);
  const { m, close } = modal(`<h3></h3><div class="preview-body"></div><div class="modal-actions"><button class="ghost close">关闭</button></div>`);
  $('h3', m).textContent = name;
  const body = $('.preview-body', m);
  $('.close', m).onclick = close;
  if (isImage(name)) { const img = el('img'); img.src = p; body.appendChild(img); }
  else { const r = await fetch(p, { credentials: 'same-origin' }); const t = await r.text(); body.appendChild(el('pre', '', t.slice(0, 200000))); }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
function openCtx(e, item) {
  e.preventDefault();
  const menu = $('#ctx-menu'); menu.innerHTML = ''; menu.classList.remove('hidden');
  const items = [
    { label: item.isDir ? '打开' : '预览', fn: () => openItem(item, true) },
    ...(!item.isDir ? [{ label: '⤓ 下载', fn: () => downloadFile(item) }] : []),
    { label: '分享', fn: () => shareItem(item) },
    ...(item.isDir ? [{ label: '⬇ 打包下载', fn: () => downloadZip(item) }] : []),
    { sep: true },
    { label: '重命名', fn: () => renameItem(item) },
    { label: '移动到', fn: () => moveItem(item) },
    { sep: true },
    { label: '🗑 移到回收站', fn: () => trashItem(item), danger: true }
  ];
  for (const it of items) {
    if (it.sep) { menu.appendChild(el('div', 'ctx-sep')); continue; }
    const c = el('div', 'ctx-item' + (it.danger ? ' danger' : ''), it.label);
    c.onclick = () => { menu.classList.add('hidden'); it.fn(); };
    menu.appendChild(c);
  }
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top = (e.clientY - 4) + 'px';
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function showLogin() {
  $('#login-overlay').classList.remove('hidden');
  setTimeout(() => $('#login-pass').focus(), 50);
}
async function doLogin() {
  const pass = $('#login-pass').value;
  $('#login-error').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { password: pass } });
    $('#login-overlay').classList.add('hidden');
    toast('登录成功', 'ok');
    refresh();
  } catch (e) {
    $('#login-error').textContent = e.message || '密码错误';
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
async function init() {
  try { state.cfg = await api('/config'); } catch (e) {}
  $('#app-name').textContent = state.cfg.appName || '我的云盘';
  $('#bucket-tag').textContent = 'bucket: ' + (state.cfg.bucket || '');
  if (state.cfg.passwordSet) {
    $('#btn-logout').classList.remove('hidden');
    if (!state.cfg.authed) { showLogin(); return; }
  }
  refresh();
}

// events
$('#btn-upload').onclick = () => { if (state.trash) return toast('不能在回收站上传'); $('#file-input').click(); };
$('#btn-folder').onclick = () => { if (state.trash) return; $('#folder-input').click(); };
$('#btn-refresh').onclick = () => state.trash ? showTrash() : refresh();
$('#btn-trash').onclick = () => showTrash();
$('#btn-logout').onclick = async () => { await api('/logout', { method: 'POST', body: {} }); location.reload(); };
$('#btn-empty-trash').onclick = emptyTrash;
$('#login-btn').onclick = doLogin;
$('#login-pass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };

$('#file-input').onchange = e => { if (e.target.files.length) { uploadFiles([...e.target.files], state.cwd); } e.target.value = ''; };
$('#folder-input').onchange = e => {
  const files = [...e.target.files];
  const prefix = files[0] ? files[0].webkitRelativePath.split('/')[0] + '/' : '';
  // Upload preserving relative path under current directory.
  const root = state.cwd ? state.cwd + '/' + prefix : prefix;
  (async () => {
    for (const f of files) {
      const rel = f.webkitRelativePath.slice(prefix.length);
      try { await uploadOne(f, rel); } catch (err) { toast(err.message, 'err'); }
    }
    setProgress(false);
    toast('文件夹上传完成', 'ok');
    refresh();
  })();
  e.target.value = '';
};

$('#search-input').oninput = debounce(async e => {
  const q = e.target.value.trim();
  $('#search-clear').classList.toggle('hidden', !q);
  if (!q) { state.searchQ = ''; showMain(); refresh(); return; }
  state.searchQ = q;
  renderSearch();
}, 300);
$('#search-clear').onclick = () => { $('#search-input').value = ''; $('#search-clear').classList.add('hidden'); state.searchQ = ''; showMain(); refresh(); };

// drag & drop
let dragCounter = 0;
document.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; $('#drop-overlay').classList.remove('hidden'); });
document.addEventListener('dragleave', e => { e.preventDefault(); if (--dragCounter <= 0) { dragCounter = 0; $('#drop-overlay').classList.add('hidden'); } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault(); dragCounter = 0; $('#drop-overlay').classList.add('hidden');
  if (state.trash) return;
  const files = [...(e.dataTransfer.files || [])];
  if (files.length) uploadFiles(files, state.cwd);
});

// global click hides ctx menu
document.addEventListener('click', e => { if (!e.target.closest('#ctx-menu')) $('#ctx-menu').classList.add('hidden'); });

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

init();
