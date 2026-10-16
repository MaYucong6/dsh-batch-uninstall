/**
 * dsh-batch-uninstall — Host half.
 *
 * A Geek-Uninstaller-style batch uninstaller for DeepSeek Harness plugins.
 *
 * This host half exposes a small JSON HTTP API under `/dsh-batch-uninstall`
 * that the bundled Python TUI (`dsh_geek_uninstall.py`) drives:
 *
 *   GET  /dsh-batch-uninstall/bundles.json   -> list bundles with a removable /
 *                                               locked classification
 *   POST /dsh-batch-uninstall/remove         -> batch-remove bundles by name
 *
 * All real work goes through the host's own `pluginManager` service
 * (`listBundles()` / `removeBundle(name)`), so the plugin respects the same
 * guard rails as DSH's built-in plugin manager — core bundles stay locked.
 *
 * Everything is reached through `ctx` and only `webServer` is a hard
 * dependency. `pluginManager` is resolved lazily through `ctx.get()`, so a
 * composition without it degrades to a clear error instead of failing boot.
 *
 * Plain JavaScript, no compiler, no DSH SDK imports — the same zero-dependency
 * shape as dsh-boot-animation's host half.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const name = 'batch-uninstall';

/** The host half cannot exist without the HTTP server that exposes its API. */
export const inject = ['webServer'];

const HERE = dirname(fileURLToPath(import.meta.url));
/** lib/index.js -> package root */
const PKG_ROOT = join(HERE, '..');

const BASE_ROUTE = '/dsh-batch-uninstall';
const PAGE_ROUTE = BASE_ROUTE + '/';
const LIST_ROUTE = BASE_ROUTE + '/bundles.json';
const REMOVE_ROUTE = BASE_ROUTE + '/remove';

/**
 * Bundles that must never be removable, independent of whatever the
 * pluginManager reports. This mirrors the protected set the Python TUI also
 * hard-codes, so both halves agree on the danger list.
 */
const CORE_PROTECTED = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-sdk-minimal',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-acp-app',
  '@deepseek-ai/dsh-headless',
]);

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0';
  } catch {
    return '0';
  }
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // 1 MiB is far more than a bundle list could ever need.
      if (size > 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function classifyBundle(bundle) {
  const name = typeof bundle?.name === 'string' ? bundle.name : '';
  const removable = bundle?.removable === true;
  const isCore = CORE_PROTECTED.has(name)
    || bundle?.removable === false
    || (name.startsWith('@deepseek-ai/dsh-') && bundle?.optional !== true);

  let risk = 'low';
  if (isCore || (name.startsWith('@deepseek-ai/dsh-') && bundle?.optional !== true)) {
    risk = 'high';
  } else if (name.startsWith('@deepseek-ai/')) {
    risk = 'medium';
  }

  return {
    name,
    version: bundle?.version ?? '',
    description: bundle?.description ?? '',
    enabled: bundle?.enabled === true,
    installed: bundle?.installed === true,
    optional: bundle?.optional === true,
    removable: removable && !isCore,
    core: isCore,
    risk,
  };
}

export function apply(ctx) {
  const logger = ctx.logger ?? console;
  const version = readVersion();

  ctx.effect(() => {
    // GET /dsh-batch-uninstall/  -> Geek 风格批量卸载网页
    const disposePage = ctx.webServer.register({
      kind: 'prefix',
      path: PAGE_ROUTE,
      handler: (req, res) => sendHtml(res, 200, renderPage(version)),
    });

    // GET /dsh-batch-uninstall/bundles.json
    const disposeList = ctx.webServer.register({
      kind: 'prefix',
      path: LIST_ROUTE,
      handler: async (req, res) => {
        try {
          const pluginManager = ctx.get('pluginManager');
          if (pluginManager == null || typeof pluginManager.listBundles !== 'function') {
            sendJson(res, { ok: false, error: 'pluginManager service unavailable' }, 503);
            return;
          }
          const bundles = await pluginManager.listBundles();
          const entries = Array.isArray(bundles) ? bundles : [];
          sendJson(res, {
            ok: true,
            version,
            entries: entries.map(classifyBundle),
            total: entries.length,
          });
        } catch (cause) {
          logger?.error?.('dsh-batch-uninstall: list failed', cause);
          sendJson(res, { ok: false, error: String(cause?.message ?? cause) }, 500);
        }
      },
    });

    // POST /dsh-batch-uninstall/remove
    const disposeRemove = ctx.webServer.register({
      kind: 'prefix',
      path: REMOVE_ROUTE,
      handler: async (req, res) => {
        try {
          const pluginManager = ctx.get('pluginManager');
          if (pluginManager == null || typeof pluginManager.removeBundle !== 'function') {
            sendJson(res, { ok: false, error: 'pluginManager service unavailable' }, 503);
            return;
          }

          let parsed;
          try {
            parsed = JSON.parse(await readBody(req));
          } catch {
            sendJson(res, { ok: false, error: 'invalid JSON body' }, 400);
            return;
          }

          const names = Array.isArray(parsed?.names) ? parsed.names.filter((n) => typeof n === 'string') : [];
          if (names.length === 0) {
            sendJson(res, { ok: false, error: 'names must be a non-empty array of strings' }, 400);
            return;
          }

          const results = [];
          for (const bundleName of names) {
            try {
              if (CORE_PROTECTED.has(bundleName)) {
                results.push({ name: bundleName, ok: false, error: 'core bundle is locked' });
                continue;
              }
              const change = await pluginManager.removeBundle(bundleName);
              results.push({ name: bundleName, ok: true, change });
            } catch (cause) {
              results.push({ name: bundleName, ok: false, error: String(cause?.message ?? cause) });
            }
          }

          const okCount = results.filter((r) => r.ok).length;
          sendJson(res, { ok: okCount === results.length, results, total: results.length, okCount });
        } catch (cause) {
          logger?.error?.('dsh-batch-uninstall: remove failed', cause);
          sendJson(res, { ok: false, error: String(cause?.message ?? cause) }, 500);
        }
      },
    });

    return () => {
      disposePage();
      disposeList();
      disposeRemove();
    };
  }, 'dsh-batch-uninstall: http api');
}

/**
 * The Geek-Uninstaller-style web UI, served at /dsh-batch-uninstall/.
 * A single self-contained HTML document: no external assets, no build step,
 * no Python — it fetches the JSON API above and renders an interactive
 * multi-select checklist with batch-uninstall and a confirmation gate.
 */
function renderPage(version) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DSH 批量插件卸载器</title>
<style>
:root {
  --bg: #0f1115;
  --panel: #171a21;
  --panel2: #1d212b;
  --border: #2a2f3a;
  --text: #e6e9ef;
  --dim: #8b93a3;
  --accent: #3d9aff;
  --green: #2ecc71;
  --yellow: #f1c40f;
  --red: #e74c3c;
  --locked: #555b68;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", Roboto, sans-serif;
  padding: 24px;
  min-height: 100vh;
}
.wrap { max-width: 980px; margin: 0 auto; }
h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
h1 .geek { color: var(--accent); }
.sub { color: var(--dim); font-size: 13px; margin-bottom: 20px; }
.toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;
}
.toolbar .stat { font-size: 13px; color: var(--dim); }
.toolbar .stat b { color: var(--text); }
.toolbar .spacer { flex: 1; }
.btn {
  border: 1px solid var(--border); background: var(--panel2);
  color: var(--text); padding: 8px 16px; border-radius: 6px;
  cursor: pointer; font-size: 13px; transition: all .15s;
}
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn.danger { background: var(--red); border-color: var(--red); color: #fff; }
.btn.danger:hover { background: #c0392b; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { background: #2f86e0; }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.list { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.row {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 1px solid var(--border); cursor: pointer; transition: background .12s;
}
.row:last-child { border-bottom: none; }
.row:hover { background: var(--panel); }
.row.locked { cursor: not-allowed; opacity: .55; }
.row.selected { background: #1a2530; }
.row input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; }
.row.locked input[type=checkbox] { accent-color: var(--locked); cursor: not-allowed; }
.row .info { flex: 1; min-width: 0; }
.row .name { font-size: 14px; font-weight: 600; }
.row .name .lock { color: var(--red); margin-right: 4px; }
.row .desc { font-size: 12px; color: var(--dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .meta { text-align: right; white-space: nowrap; }
.row .ver { font-size: 12px; color: var(--dim); }
.row .risk { font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-top: 4px; display: inline-block; }
.risk.high { background: rgba(231,76,60,.15); color: var(--red); }
.risk.medium { background: rgba(241,196,15,.15); color: var(--yellow); }
.risk.low { background: rgba(46,204,113,.15); color: var(--green); }
.footer { margin-top: 16px; color: var(--dim); font-size: 12px; text-align: center; }
.dialog-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.dialog {
  background: var(--panel); border: 1px solid var(--red); border-radius: 10px;
  padding: 24px; max-width: 480px; width: 90%;
}
.dialog h2 { color: var(--red); font-size: 18px; margin-bottom: 16px; }
.dialog .targets { background: var(--panel2); border-radius: 6px; padding: 12px; margin-bottom: 16px; max-height: 240px; overflow: auto; }
.dialog .targets div { font-size: 13px; padding: 4px 0; }
.dialog .warn { color: var(--yellow); font-size: 13px; margin-bottom: 16px; }
.dialog .actions { display: flex; gap: 12px; justify-content: flex-end; }
.progress { margin-top: 16px; display: none; }
.progress.show { display: block; }
.progress .bar-bg { background: var(--panel2); border-radius: 6px; height: 10px; overflow: hidden; }
.progress .bar-fill { background: var(--accent); height: 100%; width: 0; transition: width .3s; }
.progress .bar-text { font-size: 12px; color: var(--dim); margin-top: 6px; }
.log { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: none; max-height: 300px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.log.show { display: block; }
.log .ok { color: var(--green); }
.log .err { color: var(--red); }
.empty { text-align: center; color: var(--dim); padding: 40px; }
</style>
</head>
<body>
<div class="wrap">
  <h1><span class="geek">Geek</span> Uninstaller — DSH 批量插件卸载器</h1>
  <div class="sub">勾选要卸载的插件，点击「卸载选中项」批量移除。核心系统插件已锁定保护。 · v${version}</div>

  <div class="toolbar">
    <span class="stat">共 <b id="total">-</b> 个</span>
    <span class="stat">可卸载 <b id="removable" style="color:var(--green)">-</b></span>
    <span class="stat">🔒 锁定 <b id="locked" style="color:var(--red)">-</b></span>
    <span class="stat">已勾选 <b id="selected" style="color:var(--yellow)">0</b></span>
    <div class="spacer"></div>
    <button class="btn" id="btn-select-all">全选</button>
    <button class="btn" id="btn-select-none">全不选</button>
    <button class="btn danger" id="btn-uninstall" disabled>卸载选中项</button>
  </div>

  <div class="list" id="list"><div class="empty">加载中…</div></div>

  <div class="progress" id="progress">
    <div class="bar-bg"><div class="bar-fill" id="bar-fill"></div></div>
    <div class="bar-text" id="bar-text"></div>
  </div>
  <div class="log" id="log"></div>

  <div class="footer">数据来自 DSH pluginManager 服务 · 卸载后建议重启 DSH 生效</div>
</div>

<div class="dialog-mask" id="dialog" style="display:none">
  <div class="dialog">
    <h2>⚠ 确认批量卸载</h2>
    <div class="targets" id="dialog-targets"></div>
    <div class="warn">此操作不可撤销！核心插件已自动排除。</div>
    <div class="actions">
      <button class="btn" id="btn-cancel">取消</button>
      <button class="btn danger" id="btn-confirm">确认卸载</button>
    </div>
  </div>
</div>

<script>
const API_LIST = '/dsh-batch-uninstall/bundles.json';
const API_REMOVE = '/dsh-batch-uninstall/remove';

let bundles = [];
let checked = new Set();

const $ = id => document.getElementById(id);

async function load() {
  try {
    const r = await fetch(API_LIST);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '加载失败');
    bundles = d.entries || [];
    checked = new Set();
    render();
  } catch (e) {
    $('list').innerHTML = '<div class="empty">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function render() {
  const list = $('list');
  if (bundles.length === 0) {
    list.innerHTML = '<div class="empty">没有找到插件</div>';
    return;
  }
  list.innerHTML = '';
  bundles.forEach((b, i) => {
    const locked = b.core;
    const row = document.createElement('div');
    row.className = 'row' + (locked ? ' locked' : '') + (checked.has(i) ? ' selected' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(i);
    cb.disabled = locked;
    if (!locked) {
      cb.addEventListener('click', e => {
        e.stopPropagation();
        if (cb.checked) checked.add(i); else checked.delete(i);
        update();
      });
    }
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.innerHTML = (locked ? '<span class="lock">🔒</span>' : '') + escapeHtml(b.name);
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = b.description || '';
    info.appendChild(name); info.appendChild(desc);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const ver = document.createElement('div');
    ver.className = 'ver';
    ver.textContent = b.version || '';
    const risk = document.createElement('span');
    risk.className = 'risk ' + (b.risk || 'low');
    risk.textContent = locked ? '🔒 核心' : (b.risk === 'high' ? '⚠ 高' : b.risk === 'medium' ? '◉ 中' : '○ 低');
    meta.appendChild(ver); meta.appendChild(risk);
    row.appendChild(cb); row.appendChild(info); row.appendChild(meta);
    if (!locked) {
      row.addEventListener('click', () => {
        cb.checked = !cb.checked;
        if (cb.checked) checked.add(i); else checked.delete(i);
        update();
      });
    }
    list.appendChild(row);
  });
  update();
}

function update() {
  const removable = bundles.filter(b => !b.core).length;
  const locked = bundles.filter(b => b.core).length;
  $('total').textContent = bundles.length;
  $('removable').textContent = removable;
  $('locked').textContent = locked;
  $('selected').textContent = checked.size;
  $('btn-uninstall').disabled = checked.size === 0;
}

$('btn-select-all').addEventListener('click', () => {
  bundles.forEach((b, i) => { if (!b.core) checked.add(i); });
  render();
});
$('btn-select-none').addEventListener('click', () => {
  checked = new Set(); render();
});
$('btn-uninstall').addEventListener('click', () => {
  const targets = bundles.filter((b, i) => checked.has(i));
  $('dialog-targets').innerHTML = targets.map(b => '<div>● ' + escapeHtml(b.name) + '</div>').join('');
  $('dialog').style.display = 'flex';
});
$('btn-cancel').addEventListener('click', () => { $('dialog').style.display = 'none'; });
$('btn-confirm').addEventListener('click', async () => {
  $('dialog').style.display = 'none';
  const names = bundles.filter((b, i) => checked.has(i)).map(b => b.name);
  await doUninstall(names);
});

async function doUninstall(names) {
  const progress = $('progress'), log = $('log'), barFill = $('bar-fill'), barText = $('bar-text');
  progress.classList.add('show');
  log.classList.add('show');
  log.innerHTML = '';
  let okCount = 0;
  for (let i = 0; i < names.length; i++) {
    barText.textContent = '正在卸载 ' + (i + 1) + '/' + names.length + '：' + names[i];
    barFill.style.width = ((i / names.length) * 100) + '%';
    try {
      const r = await fetch(API_REMOVE, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({names: [names[i]]})
      });
      const d = await r.json();
      const item = d.results && d.results[0];
      if (item && item.ok) {
        okCount++;
        log.innerHTML += '<div class="ok">✓ ' + escapeHtml(names[i]) + ' 卸载成功</div>';
      } else {
        log.innerHTML += '<div class="err">✗ ' + escapeHtml(names[i]) + '：' + escapeHtml((item && item.error) || d.error || '失败') + '</div>';
      }
    } catch (e) {
      log.innerHTML += '<div class="err">✗ ' + escapeHtml(names[i]) + '：' + escapeHtml(e.message) + '</div>';
    }
    log.scrollTop = log.scrollHeight;
  }
  barFill.style.width = '100%';
  barText.textContent = '完成：' + okCount + '/' + names.length + ' 成功';
  await load();
}

load();
</script>
</body>
</html>`;
}
