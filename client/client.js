/**
 * dsh-batch-uninstall — Client half.
 *
 * Registers a "批量卸载" settings section inside the DSH settings dialog:
 * an interactive Geek-style checklist of every installed bundle, with
 * multi-select, select-all, a confirmation dialog and a batch-uninstall
 * progress log. No Python, no external page — it lives inside DSH itself.
 *
 * SAFETY (learned the hard way from the 1.1.0 boot failure):
 *  - `inject` names ONLY real Cordis services. `styles` is a client builtin
 *    (a module-table symbol), NOT a service — naming it in `inject` kept the
 *    plugin's fiber PENDING forever and the shell treated that as a failed
 *    boot, blanking the whole GUI. `slots` is a real service (dshmarket and
 *    dsh-cost-meter both inject it), so it is the only hard dependency here.
 *  - All CSS ships inside a <style> element rendered by the panel itself, so
 *    we never touch the `styles` builtin at all.
 *  - `locale` is read opportunistically through ctx.get() and never injected.
 *  - Everything the host runs on its boot path is wrapped in try/catch, so a
 *    throw here can never escape into the shell bootstrap.
 *
 * The module-loader factory form matches dshmarket / dsh-cost-meter:
 * window.__ModuleLoader__.load({ id, factory }) and the factory returns the
 * module's exports ({ name, inject, apply }).
 */
;(function () {
  'use strict'

  var MOD = { exports: {} }

  window.__ModuleLoader__.load({
    id: 'dsh-batch-uninstall',
    factory: function (require) {
      // react is always present in the host's module table.
      var React = require('react')
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useCallback = React.useCallback

      var NAME = 'dsh-batch-uninstall'
      var NS = 'dsh-batch-uninstall'
      var API_LIST = '/dsh-batch-uninstall/bundles.json'
      var API_REMOVE = '/dsh-batch-uninstall/remove'

      // ─────────────────────────────────────────────────────────
      // locale (zh default; en when the host locale is english)
      // ─────────────────────────────────────────────────────────
      var LOCALE = {
        zh: {
          nav: '批量卸载',
          title: '批量插件卸载器',
          sub: '勾选要卸载的插件后批量移除。核心系统插件已锁定保护。',
          total: '共', removable: '可卸载', locked: '锁定', selected: '已勾选',
          selectAll: '全选', selectNone: '全不选', uninstall: '卸载选中项',
          confirmTitle: '确认批量卸载', confirmWarn: '此操作不可撤销！核心插件已自动排除。',
          cancel: '取消', confirm: '确认卸载', loading: '加载中…',
          loadFailed: '加载失败：', empty: '没有找到插件', done: '完成：', ok: '成功',
          locked_: '核心', riskHigh: '高', riskMid: '中', riskLow: '低', refresh: '刷新',
        },
        en: {
          nav: 'Batch Uninstall',
          title: 'Batch Plugin Uninstaller',
          sub: 'Select plugins and remove them in one batch. Core system bundles stay locked.',
          total: 'Total', removable: 'Removable', locked: 'Locked', selected: 'Selected',
          selectAll: 'Select all', selectNone: 'Select none', uninstall: 'Uninstall selected',
          confirmTitle: 'Confirm batch uninstall', confirmWarn: 'This cannot be undone! Core bundles are excluded automatically.',
          cancel: 'Cancel', confirm: 'Uninstall', loading: 'Loading…',
          loadFailed: 'Failed to load: ', empty: 'No plugins found', done: 'Done:', ok: 'ok',
          locked_: 'core', riskHigh: 'high', riskMid: 'med', riskLow: 'low', refresh: 'Refresh',
        },
      }

      function detectLang() {
        var lang = 'zh'
        try {
          // locale is a service on the host, read opportunistically.
          var loc = require('locale')
          if (loc && typeof loc.getSnapshot === 'function') {
            var snap = loc.getSnapshot()
            var code = (snap && (snap.active || snap.locale)) || ''
            if (typeof code === 'string' && code.toLowerCase().indexOf('en') === 0) lang = 'en'
          }
        } catch (e) { /* default zh */ }
        return lang
      }

      function t() {
        return LOCALE[detectLang()] || LOCALE.zh
      }

      // ─────────────────────────────────────────────────────────
      // inline styles (rendered once by the panel; no `styles` builtin)
      // ─────────────────────────────────────────────────────────
      var CSS = [
        '.bu-wrap{display:flex;flex-direction:column;gap:12px;width:100%;color:var(--dsw-alias-label-primary,#1a1a1a)}',
        '.bu-head{display:flex;flex-direction:column;gap:2px}',
        '.bu-title{font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary,#1a1a1a)}',
        '.bu-title .geek{color:#e8734a}',
        '.bu-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.bu-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#f6f7f9)}',
        '.bu-stat{display:inline-flex;align-items:baseline;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}',
        '.bu-stat b{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#1a1a1a)}',
        '.bu-stat.ok b{color:#1f9d55}',
        '.bu-stat.lock b{color:#c2410c}',
        '.bu-stat.sel b{color:#b45309}',
        '.bu-spacer{flex:1;min-width:8px}',
        '.bu-btn{border:1px solid var(--dsw-alias-border-l2,#d7dae0);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;line-height:1.4;transition:border-color .15s,color .15s,background .15s}',
        '.bu-btn:hover:not(:disabled){border-color:#e8734a;color:#c2410c}',
        '.bu-btn:disabled{opacity:.4;cursor:not-allowed}',
        '.bu-btn.primary{background:#e8734a;border-color:#e8734a;color:#fff}',
        '.bu-btn.primary:hover:not(:disabled){background:#d4602f;border-color:#d4602f;color:#fff}',
        '.bu-list{border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:10px;overflow:auto;max-height:52vh;background:var(--dsw-alias-bg-layer-2,#fff)}',
        '.bu-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#e8eaee);cursor:pointer;transition:background .12s}',
        '.bu-row:last-child{border-bottom:none}',
        '.bu-row:hover:not(.locked){background:var(--dsw-alias-bg-layer-1,#f6f7f9)}',
        '.bu-row.locked{cursor:not-allowed;opacity:.55}',
        '.bu-row.sel{background:rgba(232,115,74,.08)}',
        '.bu-row input[type=checkbox]{width:16px;height:16px;accent-color:#e8734a;cursor:pointer;flex:none}',
        '.bu-row.locked input[type=checkbox]{cursor:not-allowed;accent-color:#9ca3af}',
        '.bu-info{flex:1;min-width:0}',
        '.bu-name{font-size:13px;font-weight:600;word-break:break-all;color:var(--dsw-alias-label-primary,#1a1a1a)}',
        '.bu-name .lock{margin-right:4px}',
        '.bu-desc{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.bu-meta{text-align:right;white-space:nowrap;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}',
        '.bu-ver{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}',
        '.bu-risk{font-size:10px;padding:1px 8px;border-radius:9px;border:1px solid transparent}',
        '.bu-risk.high{background:rgba(232,115,74,.14);color:#c2410c;border-color:rgba(232,115,74,.3)}',
        '.bu-risk.low{background:rgba(31,157,85,.12);color:#1f9d55;border-color:rgba(31,157,85,.25)}',
        '.bu-empty{text-align:center;color:var(--dsw-alias-label-secondary,#6b7280);padding:36px 0;font-size:13px}',
        '.bu-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000}',
        '.bu-dialog{background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid #e8734a;border-radius:12px;padding:20px;max-width:460px;width:88%;box-shadow:0 12px 32px rgba(0,0,0,.18)}',
        '.bu-dialog h3{color:#c2410c;font-size:15px;margin:0 0 12px}',
        '.bu-targets{background:var(--dsw-alias-bg-layer-1,#f6f7f9);border-radius:8px;padding:10px 12px;margin-bottom:12px;max-height:200px;overflow:auto}',
        '.bu-targets div{font-size:12px;padding:3px 0;color:var(--dsw-alias-label-primary,#1a1a1a)}',
        '.bu-warn{color:#b45309;font-size:12px;margin-bottom:14px}',
        '.bu-actions{display:flex;gap:10px;justify-content:flex-end}',
        '.bu-progress{height:8px;border-radius:5px;background:var(--dsw-alias-bg-layer-1,#f6f7f9);overflow:hidden;margin-top:12px}',
        '.bu-progress i{display:block;height:100%;background:#e8734a;width:0;transition:width .25s}',
        '.bu-log{margin-top:10px;border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:8px;padding:10px 12px;max-height:220px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.7;background:var(--dsw-alias-bg-layer-1,#f6f7f9)}',
        '.bu-log .ok{color:#1f9d55}',
        '.bu-log .err{color:#c2410c}',
      ].join('\n')

      // ─────────────────────────────────────────────────────────
      // Panel component
      // ─────────────────────────────────────────────────────────
      function Panel() {
        var L = t()
        var bundlesSt = useState(null)
        var bundles = bundlesSt[0], setBundles = bundlesSt[1]
        var checkedSt = useState({})
        var checked = checkedSt[0], setChecked = checkedSt[1]
        var dialogSt = useState(null)
        var dialog = dialogSt[0], setDialog = dialogSt[1]
        var runningSt = useState(false)
        var running = runningSt[0], setRunning = runningSt[1]
        var progressSt = useState({ i: 0, total: 0 })
        var progress = progressSt[0], setProgress = progressSt[1]
        var logSt = useState([])
        var log = logSt[0], setLog = logSt[1]

        var load = useCallback(function () {
          fetch(API_LIST)
            .then(function (r) { return r.json() })
            .then(function (d) { setBundles(d && d.ok ? (d.entries || []) : []) })
            .catch(function () { setBundles([]) })
        }, [])

        useEffect(function () { load() }, [load])

        var entries = bundles || []
        var removableList = entries.filter(function (b) { return !b.core })
        var lockedCount = entries.length - removableList.length
        var selectedCount = removableList.filter(function (b) { return checked[b.name] }).length

        function toggle(name, on) {
          setChecked(function (prev) {
            var next = Object.assign({}, prev)
            if (on) next[name] = true; else delete next[name]
            return next
          })
        }

        function selectAll() {
          var next = {}
          removableList.forEach(function (b) { next[b.name] = true })
          setChecked(next)
        }
        function selectNone() { setChecked({}) }

        function doUninstall(names) {
          setRunning(true); setLog([]); setProgress({ i: 0, total: names.length })
          var i = 0, okCount = 0
          function step() {
            if (i >= names.length) {
              setRunning(false); setProgress({ i: names.length, total: names.length })
              setLog(function (prev) { return prev.concat([{ kind: 'ok', text: L.done + ' ' + okCount + '/' + names.length + ' ' + L.ok }]) })
              setChecked({}); load(); return
            }
            var name = names[i]
            setProgress({ i: i, total: names.length })
            fetch(API_REMOVE, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ names: [name] }),
            })
              .then(function (r) { return r.json() })
              .then(function (d) {
                var item = d && d.results && d.results[0]
                if (item && item.ok) {
                  okCount++
                  setLog(function (prev) { return prev.concat([{ kind: 'ok', text: '✓ ' + name + ' — ' + L.ok }]) })
                } else {
                  var msg = (item && item.error) || (d && d.error) || 'failed'
                  setLog(function (prev) { return prev.concat([{ kind: 'err', text: '✗ ' + name + ' — ' + msg }]) })
                }
              })
              .catch(function (e) {
                setLog(function (prev) { return prev.concat([{ kind: 'err', text: '✗ ' + name + ' — ' + (e && e.message || e) }]) })
              })
              .then(function () { i++; step() })
          }
          step()
        }

        var pct = progress.total > 0 ? Math.round((progress.i / progress.total) * 100) : 0

        return h('div', { className: 'bu-wrap' },
          h('style', null, CSS),
          h('div', { className: 'bu-head' },
            h('div', { className: 'bu-title' }, h('span', { className: 'geek' }, 'Geek'), ' Uninstaller — ' + L.title),
            h('div', { className: 'bu-sub' }, L.sub + ' · v1.2.0')
          ),
          h('div', { className: 'bu-toolbar' },
            h('span', { className: 'bu-stat' }, L.total + ' ', h('b', null, String(entries.length))),
            h('span', { className: 'bu-stat ok' }, L.removable + ' ', h('b', null, String(removableList.length))),
            h('span', { className: 'bu-stat lock' }, L.locked + ' ', h('b', null, String(lockedCount))),
            h('span', { className: 'bu-stat sel' }, L.selected + ' ', h('b', null, String(selectedCount))),
            h('div', { className: 'bu-spacer' }),
            h('button', { className: 'bu-btn', onClick: load, disabled: running }, L.refresh),
            h('button', { className: 'bu-btn', onClick: selectAll, disabled: running || removableList.length === 0 }, L.selectAll),
            h('button', { className: 'bu-btn', onClick: selectNone, disabled: running || selectedCount === 0 }, L.selectNone),
            h('button', {
              className: 'bu-btn primary',
              disabled: running || selectedCount === 0,
              onClick: function () { setDialog(removableList.filter(function (b) { return checked[b.name] })) },
            }, L.uninstall + (selectedCount > 0 ? ' (' + selectedCount + ')' : ''))
          ),
          h('div', { className: 'bu-list' },
            bundles === null
              ? h('div', { className: 'bu-empty' }, L.loading)
              : entries.length === 0
                ? h('div', { className: 'bu-empty' }, L.empty)
                : entries.map(function (b) {
                    var locked = !!b.core
                    var isSel = !!checked[b.name]
                    return h('div', {
                      key: b.name,
                      className: 'bu-row' + (locked ? ' locked' : '') + (isSel ? ' sel' : ''),
                      onClick: function () { if (!locked && !running) toggle(b.name, !isSel) },
                    },
                      h('input', {
                        type: 'checkbox',
                        checked: isSel,
                        disabled: locked || running,
                        onClick: function (e) { e.stopPropagation() },
                        onChange: function (e) { toggle(b.name, e.target.checked) },
                      }),
                      h('div', { className: 'bu-info' },
                        h('div', { className: 'bu-name' },
                          locked ? h('span', { className: 'lock' }, '🔒') : null,
                          b.name
                        ),
                        h('div', { className: 'bu-desc', title: b.description || '' }, b.description || '')
                      ),
                      h('div', { className: 'bu-meta' },
                        h('div', { className: 'bu-ver' }, b.version || ''),
                        h('span', { className: 'bu-risk ' + (locked ? 'high' : (b.risk === 'medium' ? 'high' : 'low')) },
                          locked ? '🔒 ' + L.locked_ : (b.risk === 'medium' ? '⚠ ' + L.riskMid : '○ ' + L.riskLow))
                      )
                    )
                  })
          ),
          (running || log.length > 0)
            ? h('div', null,
                running && progress.total > 0
                  ? h('div', { className: 'bu-progress' }, h('i', { style: { width: pct + '%' } }))
                  : null,
                log.length > 0
                  ? h('div', { className: 'bu-log' }, log.map(function (l, i) { return h('div', { key: i, className: l.kind }, l.text) }))
                  : null
              )
            : null,
          dialog
            ? h('div', { className: 'bu-mask', onClick: function () { if (!running) setDialog(null) } },
                h('div', { className: 'bu-dialog', onClick: function (e) { e.stopPropagation() } },
                  h('h3', null, '⚠ ' + L.confirmTitle),
                  h('div', { className: 'bu-targets' }, dialog.map(function (b) { return h('div', { key: b.name }, '● ' + b.name) })),
                  h('div', { className: 'bu-warn' }, L.confirmWarn),
                  h('div', { className: 'bu-actions' },
                    h('button', { className: 'bu-btn', onClick: function () { setDialog(null) } }, L.cancel),
                    h('button', {
                      className: 'bu-btn primary',
                      onClick: function () {
                        var names = dialog.map(function (b) { return b.name })
                        setDialog(null); doUninstall(names)
                      },
                    }, L.confirm)
                  )
                )
              )
            : null
        )
      }

      // ─────────────────────────────────────────────────────────
      // exports — inject names ONLY real services.
      // ─────────────────────────────────────────────────────────
      MOD.exports.name = NAME
      MOD.exports.inject = ['slots']

      MOD.exports.apply = function (ctx) {
        try {
          if (!ctx || typeof ctx.slots !== 'object') {
            console.error('[dsh-batch-uninstall] slots service unavailable — section not registered')
            return
          }
          var slots = ctx.slots
          if (typeof slots.register !== 'function') {
            console.error('[dsh-batch-uninstall] slots.register unavailable — section not registered')
            return
          }

          var off = slots.register({
            name: 'settings.section',
            id: NS,
            order: 45,
            label: function () { return t().nav },
            inject: function () { return {} },
          }, function () {
            return h(Panel)
          })

          if (ctx.effect && typeof ctx.effect === 'function') {
            ctx.effect(function () {
              return function () {
                try { if (typeof off === 'function') off() } catch (e) { /* already gone */ }
              }
            }, 'dsh-batch-uninstall: settings section')
          }
        } catch (error) {
          // Never let a throw escape into the host's client-plugin bootstrap.
          console.error('[dsh-batch-uninstall] apply failed; plugin inactive this session, app unaffected', error)
        }
      }

      return MOD.exports
    },
  })
})()
