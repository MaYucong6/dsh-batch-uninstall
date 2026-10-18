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
import { readFileSync, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';

export const name = 'batch-uninstall';

/** The host half cannot exist without the HTTP server that exposes its API. */
export const inject = ['webServer'];

const HERE = dirname(fileURLToPath(import.meta.url));
/** lib/index.js -> package root */
const PKG_ROOT = join(HERE, '..');

const BASE_ROUTE = '/dsh-batch-uninstall';
const LIST_ROUTE = BASE_ROUTE + '/bundles.json';
const REMOVE_ROUTE = BASE_ROUTE + '/remove';
const WORKSPACES_ROUTE = BASE_ROUTE + '/workspaces.json';
const WORKSPACES_DELETE_ROUTE = BASE_ROUTE + '/workspaces/delete';
const TRASH_ROUTE = BASE_ROUTE + '/trash.json';
const TRASH_RESTORE_ROUTE = BASE_ROUTE + '/trash/restore';
const TRASH_EMPTY_ROUTE = BASE_ROUTE + '/trash/empty';

/** The soft-delete landing zone, beside the sessions dir. */
const SESSIONS_DIR = join(homedir(), '.dsh', 'sessions');
const TRASH_DIR = join(homedir(), '.dsh', '.trash');

/**
 * Encode a workspace path into the directory-name spelling DSH's session
 * persistence uses. Verified against the live tree byte-for-byte:
 *   - `:` `\` `/` collapse to a single `-` (separator runs fold into one)
 *   - any code point above 0x7f becomes `~XXXX` (uppercase hex, PREFIX only,
 *     no trailing `~`, so 插件 -> `~63D2~4EF6` with a single `~` between the
 *     two escapes)
 *   - the whole thing is wrapped in `--…--`
 */
function encodeWorkspaceDir(path) {
  let out = ''
  for (const ch of String(path)) {
    const code = ch.codePointAt(0)
    if (code > 0x7f) {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    } else if (ch === ':' || ch === '\\' || ch === '/') {
      if (!out.endsWith('-')) out += '-'
    } else {
      out += ch
    }
  }
  return '--' + out + '--'
}

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

    // ── Workspace helpers ─────────────────────────────────────
    async function listWorkspaces() {
      const registry = ctx.get('workspaceRegistry');
      if (registry == null || typeof registry.list !== 'function') {
        throw new Error('workspaceRegistry service unavailable');
      }
      const ws = registry.list();
      const out = [];
      for (const w of ws) {
        let sessionCount = 0;
        try { sessionCount = Array.isArray(w.sessionIds) ? w.sessionIds.length : 0; } catch {}
        out.push({
          id: w.id,
          path: w.path,
          title: w.title,
          createdAt: w.createdAt,
          sessionCount,
        });
      }
      return out;
    }

    function trashRoot() {
      return TRASH_DIR;
    }

    async function listTrash() {
      try {
        const entries = await fsp.readdir(TRASH_DIR, { withFileTypes: true });
        const out = [];
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          out.push({ id: e.name, name: e.name });
        }
        return out;
      } catch {
        return [];
      }
    }

    // ── Workspace / trash routes ──────────────────────────────

    // GET /dsh-batch-uninstall/workspaces.json
    const disposeWorkspaces = ctx.webServer.register({
      kind: 'prefix',
      path: WORKSPACES_ROUTE,
      handler: async (req, res) => {
        try {
          const workspaces = await listWorkspaces();
          sendJson(res, { ok: true, entries: workspaces, total: workspaces.length });
        } catch (cause) {
          logger?.error?.('dsh-batch-uninstall: list workspaces failed', cause);
          sendJson(res, { ok: false, error: String(cause?.message ?? cause) }, 500);
        }
      },
    });

    // POST /dsh-batch-uninstall/workspaces/delete — soft-delete to trash
    const disposeWorkspacesDelete = ctx.webServer.register({
      kind: 'prefix',
      path: WORKSPACES_DELETE_ROUTE,
      handler: async (req, res) => {
        try {
          const registry = ctx.get('workspaceRegistry');
          if (registry == null || typeof registry.delete !== 'function') {
            sendJson(res, { ok: false, error: 'workspaceRegistry service unavailable' }, 503);
            return;
          }
          let parsed;
          try { parsed = JSON.parse(await readBody(req)); }
          catch { sendJson(res, { ok: false, error: 'invalid JSON body' }, 400); return; }

          const ids = Array.isArray(parsed?.ids) ? parsed.ids.filter((n) => typeof n === 'string') : [];
          if (ids.length === 0) {
            sendJson(res, { ok: false, error: 'ids must be a non-empty array of strings' }, 400);
            return;
          }

          const results = [];
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          for (const id of ids) {
            try {
              // Find the workspace to learn its path before deleting the
              // registration (the registry keeps dirs/logs, but we want to
              // soft-delete the on-disk session dir too).
              const ws = (registry.list ? registry.list() : []).find((w) => w.id === id);
              const enc = ws ? encodeWorkspaceDir(ws.path) : null;

              const removed = await registry.delete(id);

              // Soft-delete the on-disk session dir (if it exists).
              let moved = false;
              if (enc) {
                const src = join(SESSIONS_DIR, enc);
                try {
                  const st = await fsp.stat(src);
                  if (st.isDirectory()) {
                    await fsp.mkdir(TRASH_DIR, { recursive: true });
                    const dst = join(TRASH_DIR, `${stamp}__${enc}`);
                    await fsp.rename(src, dst);
                    moved = true;
                  }
                } catch { /* dir already gone or moved */ }
              }

              results.push({ id, ok: true, removed, moved });
            } catch (cause) {
              results.push({ id, ok: false, error: String(cause?.message ?? cause) });
            }
          }
          const okCount = results.filter((r) => r.ok).length;
          sendJson(res, { ok: okCount === results.length, results, total: results.length, okCount });
        } catch (cause) {
          logger?.error?.('dsh-batch-uninstall: delete workspaces failed', cause);
          sendJson(res, { ok: false, error: String(cause?.message ?? cause) }, 500);
        }
      },
    });

    // GET /dsh-batch-uninstall/trash.json
    const disposeTrashList = ctx.webServer.register({
      kind: 'prefix',
      path: TRASH_ROUTE,
      handler: async (req, res) => {
        try {
          const entries = await listTrash();
          sendJson(res, { ok: true, entries, total: entries.length });
        } catch (cause) {
          logger?.error?.('dsh-batch-uninstall: list trash failed', cause);
          sendJson(res, { ok: false, error: String(cause?.message ?? cause) }, 500);
        }
      },
    });

    // POST /dsh-batch-uninstall/trash/restore — move a trash entry back
    const disposeTrashRestore = ctx.webServer.register({
      kind: 'prefix',
      path: TRASH_RESTORE_ROUTE,
      handler: async (req, res) => {
        try {
          let parsed;
          try { parsed = JSON.parse(await readBody(req)); }
          catch { sendJson(res, { ok: false, error: 'invalid JSON body' }, 400); return; }
          const names = Array.isArray(parsed?.names) ? parsed.names.filter((n) => typeof n === 'string') : [];
          if (names.length === 0) {
            sendJson(res, { ok: false, error: 'names must be a non-empty array of strings' }, 400);
            return;
          }
          const results = [];
          for (const name of names) {
            try {
              // name looks like <stamp>__--<enc>--; restore to sessions dir.
              const idx = name.indexOf('__');
              const enc = idx === -1 ? name : name.slice(idx + 2);
              const src = join(TRASH_DIR, name);
              const dst = join(SESSIONS_DIR, enc);
              await fsp.rename(src, dst);
              results.push({ name, ok: true });
            } catch (cause) {
              results.push({ name, ok: false, error: String(cause?.message ?? cause) });
            }
          }
          const okCount = results.filter((r) => r.ok).length;
          sendJson(res, { ok: okCount === results.length, results, total: results.length, okCount });
        } catch (cause) {
          logger?.error?.('dsh-batch-uninstall: restore trash failed', cause);
          sendJson(res, { ok: false, error: String(cause?.message ?? cause) }, 500);
        }
      },
    });

    // POST /dsh-batch-uninstall/trash/empty — permanently remove all trash
    const disposeTrashEmpty = ctx.webServer.register({
      kind: 'prefix',
      path: TRASH_EMPTY_ROUTE,
      handler: async (req, res) => {
        try {
          let removed = 0;
          try {
            const entries = await fsp.readdir(TRASH_DIR, { withFileTypes: true });
            for (const e of entries) {
              if (!e.isDirectory()) continue;
              await fsp.rm(join(TRASH_DIR, e.name), { recursive: true, force: true });
              removed++;
            }
          } catch { /* empty or missing */ }
          sendJson(res, { ok: true, removed });
        } catch (cause) {
          logger?.error?.('dsh-batch-uninstall: empty trash failed', cause);
          sendJson(res, { ok: false, error: String(cause?.message ?? cause) }, 500);
        }
      },
    });

    return () => {
      disposeList();
      disposeRemove();
      disposeWorkspaces();
      disposeWorkspacesDelete();
      disposeTrashList();
      disposeTrashRestore();
      disposeTrashEmpty();
    };
  }, 'dsh-batch-uninstall: http api');
}
