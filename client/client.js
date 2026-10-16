/**
 * dsh-batch-uninstall — Client half.
 *
 * Registers a "批量卸载" settings section inside the DSH settings dialog:
 * an interactive Geek-style checklist of every installed bundle, with
 * multi-select, select-all, a confirmation dialog and a batch-uninstall
 * progress log. No Python, no external page — it lives inside DSH itself.
 *
 * Plain JavaScript, no compiler, no build step. The module-loader factory
 * form matches what dsh-cost-meter ships: the host runs this file through
 * window.__ModuleLoader__.load with a module table, and the factory returns
 * the module's exports.
 *
 * Data comes from this package's own host half over plain HTTP:
 *   GET  /dsh-batch-uninstall/bundles.json
 *   POST /dsh-batch-uninstall/remove
 */
;(function () {
  'use strict'

  var MOD = { exports: {} }

  window.__ModuleLoader__.load({
    id: 'dsh-batch-uninstall',
    factory: function (dt) {
      var React = dt('react')
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useCallback = React.useCallback

      var NAME = 'dsh-batch-uninstall'
      var NS = 'dsh-batch-uninstall'
      var API_LIST = '/dsh-batch-uninstall/bundles.json'
      var API_REMOVE = '/dsh-batch-uninstall/remove'

      // ─────────────────────────────────────────────────────────
      // locale
      // ─────────────────────────────────────────────────────────
      var LOCALE = {
        zh: {
          nav: '批量卸载',
          title: '批量插件卸载器',
          sub: '勾选要卸载的插件后批量移除。核心系统插件已锁定保护。',
          total: '共',
          removable: '可卸载',
          locked: '锁定',
          selected: '已勾选',
          selectAll: '全选',
          selectNone: '全不选',
          uninstall: '卸载选中项',
          confirmTitle: '确认批量卸载',
          confirmWarn: '此操作不可撤销！核心插件已自动排除。',
          cancel: '取消',
          confirm: '确认卸载',
          loading: '加载中…',
          loadFailed: '加载失败：',
          empty: '没有找到插件',
          removing: '正在卸载',
          done: '完成：',
          ok: '成功',
          locked_: '核心',
          riskHigh: '高',
          riskMid: '中',
          riskLow: '低',
          serviceMissing: 'pluginManager 服务不可用，请重启 DSH 后重试。',
          refresh: '刷新',
        },
        en: {
          nav: 'Batch Uninstall',
          title: 'Batch Plugin Uninstaller',
          sub: 'Select plugins and remove them in one batch. Core system bundles stay locked.',
          total: 'Total',
          removable: 'Removable',
          locked: 'Locked',
          selected: 'Selected',
          selectAll: 'Select all',
          selectNone: 'Select none',
          uninstall: 'Uninstall selected',
          confirmTitle: 'Confirm batch uninstall',
          confirmWarn: 'This cannot be undone! Core bundles are excluded automatically.',
          cancel: 'Cancel',
          confirm: 'Uninstall',
          loading: 'Loading…',
          loadFailed: 'Failed to load: ',
          empty: 'No plugins found',
          removing: 'Removing',
          done: 'Done:',
          ok: 'ok',
          locked_: 'core',
          riskHigh: 'high',
          riskMid: 'med',
          riskLow: 'low',
          serviceMissing: 'pluginManager service unavailable. Restart DSH and try again.',
          refresh: 'Refresh',
        },
      }

      function localeOf() {
        try {
          var loc = dt('locale')
          var lang = loc && typeof loc.getSnapshot === 'function'
            ? (loc.getSnapshot().locale || loc.getSnapshot().active)
            : null
          if (typeof lang === 'string' && lang.toLowerCase().startsWith('en')) return 'en'
        } catch (e) { /* default below */ }
        return 'zh'
      }

      // ─────────────────────────────────────────────────────────
      // styles (injected once, cleaned up with the client run)
      // ─────────────────────────────────────────────────────────
      var CSS = [
        '.bu-wrap{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-text-primary,#e6e9ef);width:100%}',
        '.bu-head{display:flex;flex-direction:column;gap:2px}',
        '.bu-title{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}',
        '.bu-title .geek{color:#e8734a}',
        '.bu-sub{font-size:12px;color:var(--dsw-alias-text-secondary,#8b93a3)}',
        '.bu-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--dsw-alias-border-l3,#2a2f3a);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#171a21)}',
        '.bu-stat{font-size:12px;color:var(--dsw-alias-text-secondary,#8b93a3)}',
        '.bu-stat b{color:var(--dsw-alias-text-primary,#e6e9ef)}',
        '.bu-stat.ok b{color:#34c77b}',
        '.bu-stat.lock b{color:#e8734a}',
        '.bu-stat.sel b{color:#f5b93d}',
        '.bu-spacer{flex:1}',
        '.bu-btn{border:1px solid var(--dsw-alias-border-l3,#2a2f3a);background:transparent;color:var(--dsw-alias-text-primary,#e6e9ef);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;transition:opacity .15s,border-color .15s}',
        '.bu-btn:hover:not(:disabled){border-color:#e8734a;color:#e8734a}',
        '.bu-btn:disabled{opacity:.35;cursor:not-allowed}',
        '.bu-btn.primary{background:#e8734a;border-color:#e8734a;color:#fff}',
        '.bu-btn.primary:hover:not(:disabled){background:#d4602f;color:#fff}',
        '.bu-list{border:1px solid var(--dsw-alias-border-l3,#2a2f3a);border-radius:10px;overflow:auto;max-height:52vh}',
        '.bu-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#22262f);cursor:pointer;transition:background .12s}',
        '.bu-row:last-child{border-bottom:none}',
        '.bu-row:hover:not(.locked){background:var(--dsw-alias-bg-layer-1,#1d212b)}',
        '.bu-row.locked{cursor:not-allowed;opacity:.5}',
        '.bu-row.sel{background:rgba(232,115,74,.08)}',
        '.bu-row input[type=checkbox]{width:16px;height:16px;accent-color:#e8734a;cursor:pointer;flex:none}',
        '.bu-row.locked input[type=checkbox]{cursor:not-allowed;accent-color:#555b68}',
        '.bu-info{flex:1;min-width:0}',
        '.bu-name{font-size:13px;font-weight:600;word-break:break-all}',
        '.bu-name .lock{margin-right:4px}',
        '.bu-desc{font-size:11px;color:var(--dsw-alias-text-secondary,#8b93a3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.bu-meta{text-align:right;white-space:nowrap;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}',
        '.bu-ver{font-size:11px;color:var(--dsw-alias-text-secondary,#8b93a3)}',
        '.bu-risk{font-size:10px;padding:1px 8px;border-radius:9px;border:1px solid transparent}',
        '.bu-risk.high{background:rgba(232,115,74,.14);color:#e8734a;border-color:rgba(232,115,74,.3)}',
        '.bu-risk.low{background:rgba(52,199,123,.12);color:#34c77b;border-color:rgba(52,199,123,.25)}',
        '.bu-empty{text-align:center;color:var(--dsw-alias-text-secondary,#8b93a3);padding:36px 0;font-size:13px}',
        '.bu-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1000}',
        '.bu-dialog{background:var(--dsw-alias-bg-layer-2,#171a21);border:1px solid #e8734a;border-radius:12px;padding:20px;max-width:460px;width:88%}',
        '.bu-dialog h3{color:#e8734a;font-size:15px;margin:0 0 12px}',
        '.bu-targets{background:var(--dsw-alias-bg-layer-1,#1d212b);border-radius:8px;padding:10px 12px;margin-bottom:12px;max-height:200px;overflow:auto}',
        '.bu-targets div{font-size:12px;padding:3px 0}',
        '.bu-warn{color:#f5b93d;font-size:12px;margin-bottom:14px}',
        '.bu-actions{display:flex;gap:10px;justify-content:flex-end}',
        '.bu-progress{height:8px;border-radius:5px;background:var(--dsw-alias-bg-layer-1,#1d212b);overflow:hidden;margin-top:12px}',
        '.bu-progress i{display:block;height:100%;background:#e8734a;width:0;transition:width .25s}',
        '.bu-log{margin-top:10px;border:1px solid var(--dsw-alias-border-l3,#2a2f3a);border-radius:8px;padding:10px 12px;max-height:220px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.7}',
        '.bu-log .ok{color:#34c77b}',
        '.bu-log .err{color:#e8734a}',
      ].join('\n')

      function useLocale() {
        var st = useState(localeOf())
        var lang = st[0], setLang = st[1]
        useEffect(function () {
          var id = setInterval(function () {
            var next = localeOf()
            if (next !== lang) setLang(next)
          }, 800)
          return function () { clearInterval(id) }
        }, [lang])
        return LOCALE[lang] || LOCALE.zh
      }

      // ─────────────────────────────────────────────────────────
      // main panel
      // ─────────────────────────────────────────────────────────
      function Panel() {
        var t = useLocale()
        var bundlesSt = useState(null)
        var bundles = bundlesSt[0], setBundles = bundlesSt[1]
        var checkedSt = useState({})
        var checked = checkedSt[0], setChecked = checkedSt[1]
        var dialogSt = useState(null)
        var dialog = dialogSt[0], setDialog = dialogSt[1]
        var runningSt = useState(false)
        var running = runningSt[0], setRunning = runningSt[1]
        var progressSt = useState({ i: 0, total: 0, name: '' })
        var progress = progressSt[0], setProgress = progressSt[1]
        var logSt = useState([])
        var log = logSt[0], setLog = logSt[1]

        var load = useCallback(function () {
          fetch(API_LIST)
            .then(function (r) { return r.json() })
            .then(function (d) {
              if (d && d.ok) setBundles(d.entries || [])
              else setBundles([])
            })
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
            if (on) next[name] = true
            else delete next[name]
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
          setRunning(true)
          setLog([])
          setProgress({ i: 0, total: names.length, name: names[0] || '' })
          var i = 0
          var okCount = 0
          function step() {
            if (i >= names.length) {
              setRunning(false)
              setProgress(function (p) { return Object.assign({}, p, { name: '' }) })
              setLog(function (prev) {
                return prev.concat([{ kind: 'done', text: t.done + ' ' + okCount + '/' + names.length + ' ' + t.ok }])
              })
              setChecked({})
              load()
              return
            }
            var name = names[i]
            setProgress({ i: i, total: names.length, name: name })
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
                  setLog(function (prev) { return prev.concat([{ kind: 'ok', text: '✓ ' + name + ' — ' + t.ok }]) })
                } else {
                  var msg = (item && item.error) || (d && d.error) || 'failed'
                  if (msg === 'pluginManager service unavailable') msg = t.serviceMissing
                  setLog(function (prev) { return prev.concat([{ kind: 'err', text: '✗ ' + name + ' — ' + msg }]) })
                }
              })
              .catch(function (e) {
                setLog(function (prev) { return prev.concat([{ kind: 'err', text: '✗ ' + name + ' — ' + (e && e.message || e) }]) })
              })
              .then(function () {
                i++
                step()
              })
          }
          step()
        }

        var pct = progress.total > 0 ? Math.round((progress.i / progress.total) * 100) : 0

        return h('div', { className: 'bu-wrap' },
          h('div', { className: 'bu-head' },
            h('div', { className: 'bu-title' },
              h('span', { className: 'geek' }, 'Geek'),
              ' Uninstaller — ' + t.title
            ),
            h('div', { className: 'bu-sub' }, t.sub + ' · v1.1.0')
          ),
          h('div', { className: 'bu-toolbar' },
            h('span', { className: 'bu-stat' }, t.total + ' ', h('b', null, String(entries.length))),
            h('span', { className: 'bu-stat ok' }, t.removable + ' ', h('b', null, String(removableList.length))),
            h('span', { className: 'bu-stat lock' }, t.locked + ' ', h('b', null, String(lockedCount))),
            h('span', { className: 'bu-stat sel' }, t.selected + ' ', h('b', null, String(selectedCount))),
            h('div', { className: 'bu-spacer' }),
            h('button', { className: 'bu-btn', onClick: load, disabled: running }, t.refresh),
            h('button', { className: 'bu-btn', onClick: selectAll, disabled: running || removableList.length === 0 }, t.selectAll),
            h('button', { className: 'bu-btn', onClick: selectNone, disabled: running || selectedCount === 0 }, t.selectNone),
            h('button', {
              className: 'bu-btn primary',
              disabled: running || selectedCount === 0,
              onClick: function () {
                setDialog(removableList.filter(function (b) { return checked[b.name] }))
              },
            }, t.uninstall + (selectedCount > 0 ? ' (' + selectedCount + ')' : ''))
          ),
          h('div', { className: 'bu-list' },
            bundles === null
              ? h('div', { className: 'bu-empty' }, t.loading)
              : entries.length === 0
                ? h('div', { className: 'bu-empty' }, t.empty)
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
                        h('span', {
                          className: 'bu-risk ' + (locked ? 'high' : (b.risk === 'medium' ? 'high' : 'low')),
                        }, locked ? '🔒 ' + t.locked_ : (b.risk === 'medium' ? '⚠ ' + t.riskMid : '○ ' + t.riskLow))
                      )
                    )
                  })
          ),
          running || log.length > 0
            ? h('div', null,
                running && progress.total > 0
                  ? h('div', { className: 'bu-progress' },
                      h('i', { style: { width: pct + '%' } })
                    )
                  : null,
                log.length > 0
                  ? h('div', { className: 'bu-log' },
                      log.map(function (l, i) {
                        return h('div', { key: i, className: l.kind }, l.text)
                      })
                    )
                  : null
              )
            : null,
          dialog
            ? h('div', {
                className: 'bu-mask',
                onClick: function () { if (!running) setDialog(null) },
              },
                h('div', {
                  className: 'bu-dialog',
                  onClick: function (e) { e.stopPropagation() },
                },
                  h('h3', null, '⚠ ' + t.confirmTitle),
                  h('div', { className: 'bu-targets' },
                    dialog.map(function (b) {
                      return h('div', { key: b.name }, '● ' + b.name)
                    })
                  ),
                  h('div', { className: 'bu-warn' }, t.confirmWarn),
                  h('div', { className: 'bu-actions' },
                    h('button', { className: 'bu-btn', onClick: function () { setDialog(null) } }, t.cancel),
                    h('button', {
                      className: 'bu-btn primary',
                      onClick: function () {
                        var names = dialog.map(function (b) { return b.name })
                        setDialog(null)
                        doUninstall(names)
                      },
                    }, t.confirm)
                  )
                )
              )
            : null
        )
      }

      // ─────────────────────────────────────────────────────────
      // module exports — the host calls apply(ctx) with the client context
      // ─────────────────────────────────────────────────────────
      MOD.exports.name = NAME

      /**
       * NO module-level inject, deliberately.
       *
       * A client plugin that names a service this host does not provide keeps
       * its fiber PENDING forever, and the shell counts a pending entry as a
       * failed boot ("N entries did not activate") — one wrong name takes the
       * whole GUI down with it. That is exactly what `inject: ['slots',
       * 'styles']` did in 1.1.0: `styles` is not a service at all (it is a
       * module-table builtin, reached with dt('styles')), so the plugin never
       * activated and every session failed to boot.
       *
       * So: no hard dependencies here, and `slots` is reached through a NESTED
       * ctx.inject below, which pends on its own without blocking the shell.
       * Everything is wrapped so a throw in here can never escape into the
       * host's client-plugin bootstrap path.
       */
      MOD.exports.inject = []

      MOD.exports.apply = function (ctx) {
        var disposers = []

        function cleanup() {
          for (var i = 0; i < disposers.length; i++) {
            try { disposers[i]() } catch (e) { /* already gone */ }
          }
          disposers = []
        }

        try {
          // `styles` is a client BUILTIN: dt('styles') is the lookup.
          // Never name it in inject — see the note above.
          try {
            var styles = dt('styles')
            if (styles && typeof styles.insert === 'function') {
              var removeCss = styles.insert(CSS)
              if (typeof removeCss === 'function') disposers.push(removeCss)
            }
          } catch (e) {
            console.error('[dsh-batch-uninstall] stylesheet insert failed (panel will render unstyled)', e)
          }

          if (!ctx || typeof ctx.inject !== 'function') {
            console.error('[dsh-batch-uninstall] ctx.inject unavailable — settings section not registered')
            return
          }

          // Nested: waits for `slots` on its own fiber, so an absent service
          // costs the section, never the boot.
          ctx.inject(['slots'], function (scoped) {
            try {
              var slots = scoped && scoped.slots
              if (!slots || typeof slots.register !== 'function') {
                console.error('[dsh-batch-uninstall] slots service unavailable — settings section not registered')
                return
              }

              var off = slots.register({
                name: 'settings.section',
                id: NS,
                order: 45,
                label: function () { return (LOCALE[localeOf()] || LOCALE.zh).nav },
                inject: function () { return {} },
              }, function () {
                return h(Panel)
              })

              if (typeof off === 'function') disposers.push(off)
            } catch (e) {
              console.error('[dsh-batch-uninstall] settings section registration failed', e)
            }
          })

          try {
            if (typeof ctx.effect === 'function') {
              ctx.effect(function () { return cleanup }, 'dsh-batch-uninstall: section + css')
            }
          } catch (e) {
            console.error('[dsh-batch-uninstall] effect registration failed (panel stays mounted)', e)
          }
        } catch (error) {
          // The host runs this factory on the boot path with nothing between it
          // and the shell, so a throw here would blank the GUI. Contain it.
          console.error('[dsh-batch-uninstall] apply failed; plugin inactive this session, app unaffected', error)
        }
      }

      return MOD.exports
    },
  })
})()
