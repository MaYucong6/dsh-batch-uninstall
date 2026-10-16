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

    return () => {
      disposeList();
      disposeRemove();
    };
  }, 'dsh-batch-uninstall: http api');
}
