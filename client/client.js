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
      var API_WORKSPACES = '/dsh-batch-uninstall/workspaces.json'
      var API_WORKSPACES_DELETE = '/dsh-batch-uninstall/workspaces/delete'
      var API_TRASH = '/dsh-batch-uninstall/trash.json'
      var API_TRASH_RESTORE = '/dsh-batch-uninstall/trash/restore'
      var API_TRASH_EMPTY = '/dsh-batch-uninstall/trash/empty'

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
          tabPlugins: '插件', tabWorkspaces: '工作区', tabTrash: '回收站',
          wsTitle: '工作区管理', wsSub: '勾选要删除的工作区，删除后其会话目录进入回收站，可恢复。',
          wsPath: '路径', wsSessions: '会话数', wsDelete: '删除选中工作区',
          wsConfirmTitle: '确认删除工作区', wsConfirmWarn: '工作区会话目录将被移入回收站，可恢复。',
          wsEmpty: '没有工作区',
          trashTitle: '回收站', trashSub: '已删除的工作区会话目录。可恢复或永久清空。',
          trashRestore: '恢复选中项', trashEmpty: '一键清空回收站',
          trashEmptyTitle: '确认清空回收站', trashEmptyWarn: '将永久删除回收站内所有内容，不可恢复！',
          trashEmptyDone: '已清空', trashRestored: '已恢复',
          trashEmptyHint: '回收站是空的',
          workspaceDeleteDone: '删除完成', workspaceDeleteFailed: '删除失败',
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
          tabPlugins: 'Plugins', tabWorkspaces: 'Workspaces', tabTrash: 'Trash',
          wsTitle: 'Workspace Manager', wsSub: 'Select workspaces to delete. Their session folders move to trash and can be restored.',
          wsPath: 'Path', wsSessions: 'Sessions', wsDelete: 'Delete selected',
          wsConfirmTitle: 'Confirm workspace deletion', wsConfirmWarn: 'Workspace session folders will be moved to trash and can be restored.',
          wsEmpty: 'No workspaces',
          trashTitle: 'Trash', trashSub: 'Deleted workspace session folders. Restore or permanently empty.',
          trashRestore: 'Restore selected', trashEmpty: 'Empty trash',
          trashEmptyTitle: 'Confirm empty trash', trashEmptyWarn: 'Permanently delete everything in trash. This cannot be undone!',
          trashEmptyDone: 'Emptied', trashRestored: 'Restored',
          trashEmptyHint: 'Trash is empty',
          workspaceDeleteDone: 'Deleted', workspaceDeleteFailed: 'Delete failed',
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
        '.bu-wrap{display:flex;flex-direction:column;gap:12px;width:100%;color:inherit;font-size:13px}',
        '.bu-tabs{display:flex;gap:6px;border-bottom:1px solid rgba(128,128,128,.25);padding-bottom:8px;margin-bottom:2px}',
        '.bu-tab{padding:6px 16px;border-radius:8px 8px 0 0;border:1px solid transparent;cursor:pointer;font-size:13px;font-weight:600;color:#7b8290;background:transparent;transition:all .15s;font-family:inherit}',
        '.bu-tab:hover{color:inherit;border-color:rgba(128,128,128,.25)}',
        '.bu-tab.active{color:#c2410c;border-color:rgba(232,115,74,.4);border-bottom-color:transparent;background:rgba(232,115,74,.08)}',
        '.bu-head{display:flex;flex-direction:column;gap:2px}',
        '.bu-title{font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px;color:inherit}',
        '.bu-title .geek{color:#e8734a}',
        '.bu-sub{font-size:12px;color:#7b8290}',
        '.bu-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 14px;border:1px solid rgba(128,128,128,.3);border-radius:10px;background:rgba(128,128,128,.06)}',
        '.bu-stat{display:inline-flex;align-items:baseline;gap:5px;font-size:12px;white-space:nowrap}',
        '.bu-stat .bu-k{color:#7b8290}',
        '.bu-stat b{font-size:13px;font-weight:700;color:inherit}',
        '.bu-stat.ok b{color:#1f9d55}',
        '.bu-stat.lock b{color:#c2410c}',
        '.bu-stat.sel b{color:#b45309}',
        '.bu-spacer{flex:1;min-width:8px}',
        '.bu-btn{color:inherit;background:transparent;border:1px solid rgba(128,128,128,.32);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;line-height:1.4;font-family:inherit;transition:border-color .15s,color .15s,background .15s}',
        '.bu-btn:hover:not(:disabled){border-color:#e8734a;color:#c2410c}',
        '.bu-btn:disabled{opacity:.45;cursor:not-allowed}',
        '.bu-btn.primary{background:#e8734a;border-color:#e8734a;color:#fff}',
        '.bu-btn.primary:hover:not(:disabled){background:#d4602f;border-color:#d4602f;color:#fff}',
        '.bu-list{border:1px solid rgba(128,128,128,.3);border-radius:10px;overflow:auto;max-height:52vh}',
        '.bu-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(128,128,128,.18);cursor:pointer;transition:background .12s}',
        '.bu-row:last-child{border-bottom:none}',
        '.bu-row:hover:not(.locked){background:rgba(128,128,128,.08)}',
        '.bu-row.locked{cursor:not-allowed;opacity:.55}',
        '.bu-row.sel{background:rgba(232,115,74,.1)}',
        '.bu-row input[type=checkbox]{width:16px;height:16px;accent-color:#e8734a;cursor:pointer;flex:none}',
        '.bu-row.locked input[type=checkbox]{cursor:not-allowed;accent-color:#9ca3af}',
        '.bu-info{flex:1;min-width:0}',
        '.bu-name{font-size:13px;font-weight:600;word-break:break-all;color:inherit}',
        '.bu-name .lock{margin-right:4px}',
        '.bu-desc{font-size:11px;color:#7b8290;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.bu-meta{text-align:right;white-space:nowrap;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}',
        '.bu-ver{font-size:11px;color:#7b8290}',
        '.bu-risk{font-size:10px;padding:1px 8px;border-radius:9px;border:1px solid transparent}',
        '.bu-risk.high{background:rgba(232,115,74,.16);color:#c2410c;border-color:rgba(232,115,74,.35)}',
        '.bu-risk.low{background:rgba(31,157,85,.14);color:#1f9d55;border-color:rgba(31,157,85,.3)}',
        '.bu-empty{text-align:center;color:#7b8290;padding:36px 0;font-size:13px}',
        '.bu-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000}',
        '.bu-dialog{background:#fff;color:#1a1a1a;border:1px solid #e8734a;border-radius:12px;padding:20px;max-width:460px;width:88%;box-shadow:0 12px 32px rgba(0,0,0,.22);font-family:inherit}',
        '.bu-dialog h3{color:#c2410c;font-size:15px;margin:0 0 12px;font-weight:700}',
        '.bu-targets{background:rgba(128,128,128,.08);border-radius:8px;padding:10px 12px;margin-bottom:12px;max-height:200px;overflow:auto}',
        '.bu-targets div{font-size:12px;padding:3px 0;color:inherit}',
        '.bu-warn{color:#b45309;font-size:12px;margin-bottom:14px}',
        '.bu-actions{display:flex;gap:10px;justify-content:flex-end}',
        '.bu-progress{height:8px;border-radius:5px;background:rgba(128,128,128,.18);overflow:hidden;margin-top:12px}',
        '.bu-progress i{display:block;height:100%;background:#e8734a;width:0;transition:width .25s}',
        '.bu-log{margin-top:10px;border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:10px 12px;max-height:220px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.7;background:rgba(128,128,128,.06)}',
        '.bu-log .ok{color:#1f9d55}',
        '.bu-log .err{color:#c2410c}',
      ].join('\n')

      // ─────────────────────────────────────────────────────────
      // PluginsPanel component (the original batch-uninstall UI)
      // ─────────────────────────────────────────────────────────
      function PluginsPanel() {
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
            h('div', { className: 'bu-sub' }, L.sub + ' · v1.3.0')
          ),
          h('div', { className: 'bu-toolbar' },
            h('span', { className: 'bu-stat' }, h('span', { className: 'bu-k' }, L.total), h('b', null, String(entries.length))),
            h('span', { className: 'bu-stat ok' }, h('span', { className: 'bu-k' }, L.removable), h('b', null, String(removableList.length))),
            h('span', { className: 'bu-stat lock' }, h('span', { className: 'bu-k' }, L.locked), h('b', null, String(lockedCount))),
            h('span', { className: 'bu-stat sel' }, h('span', { className: 'bu-k' }, L.selected), h('b', null, String(selectedCount))),
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
      // WorkspacesPanel — batch soft-delete workspaces to trash
      // ─────────────────────────────────────────────────────────
      function WorkspacesPanel() {
        var L = t()
        var itemsSt = useState(null)
        var items = itemsSt[0], setItems = itemsSt[1]
        var checkedSt = useState({})
        var checked = checkedSt[0], setChecked = checkedSt[1]
        var dialogSt = useState(null)
        var dialog = dialogSt[0], setDialog = dialogSt[1]
        var runningSt = useState(false)
        var running = runningSt[0], setRunning = runningSt[1]
        var logSt = useState([])
        var log = logSt[0], setLog = logSt[1]

        var load = useCallback(function () {
          fetch(API_WORKSPACES)
            .then(function (r) { return r.json() })
            .then(function (d) { setItems(d && d.ok ? (d.entries || []) : []) })
            .catch(function () { setItems([]) })
        }, [])
        useEffect(function () { load() }, [load])

        var entries = items || []
        var selectedCount = entries.filter(function (w) { return checked[w.id] }).length

        function toggle(id, on) {
          setChecked(function (prev) {
            var next = Object.assign({}, prev)
            if (on) next[id] = true; else delete next[id]
            return next
          })
        }
        function selectAll() { var n = {}; entries.forEach(function (w) { n[w.id] = true }); setChecked(n) }
        function selectNone() { setChecked({}) }

        function doDelete(ids) {
          setRunning(true); setLog([])
          fetch(API_WORKSPACES_DELETE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids }),
          })
            .then(function (r) { return r.json() })
            .then(function (d) {
              var rs = d && d.results || []
              var okCount = 0
              rs.forEach(function (it) {
                if (it.ok) { okCount++; setLog(function (p) { return p.concat([{ kind: 'ok', text: '✓ ' + it.id + ' — ' + L.workspaceDeleteDone }]) }) }
                else setLog(function (p) { return p.concat([{ kind: 'err', text: '✗ ' + it.id + ' — ' + (it.error || L.workspaceDeleteFailed) }]) })
              })
              setRunning(false); setChecked({}); load()
            })
            .catch(function (e) {
              setRunning(false)
              setLog(function (p) { return p.concat([{ kind: 'err', text: '✗ ' + (e && e.message || e) }]) })
            })
        }

        return h('div', { className: 'bu-wrap' },
          h('style', null, CSS),
          h('div', { className: 'bu-head' },
            h('div', { className: 'bu-title' }, h('span', { className: 'geek' }, 'Geek'), ' — ' + L.wsTitle),
            h('div', { className: 'bu-sub' }, L.wsSub + ' · v1.3.0')
          ),
          h('div', { className: 'bu-toolbar' },
            h('span', { className: 'bu-stat' }, h('span', { className: 'bu-k' }, L.total), h('b', null, String(entries.length))),
            h('span', { className: 'bu-stat sel' }, h('span', { className: 'bu-k' }, L.selected), h('b', null, String(selectedCount))),
            h('div', { className: 'bu-spacer' }),
            h('button', { className: 'bu-btn', onClick: load, disabled: running }, L.refresh),
            h('button', { className: 'bu-btn', onClick: selectAll, disabled: running || entries.length === 0 }, L.selectAll),
            h('button', { className: 'bu-btn', onClick: selectNone, disabled: running || selectedCount === 0 }, L.selectNone),
            h('button', {
              className: 'bu-btn primary', disabled: running || selectedCount === 0,
              onClick: function () { setDialog(entries.filter(function (w) { return checked[w.id] })) },
            }, L.wsDelete + (selectedCount > 0 ? ' (' + selectedCount + ')' : ''))
          ),
          h('div', { className: 'bu-list' },
            items === null
              ? h('div', { className: 'bu-empty' }, L.loading)
              : entries.length === 0
                ? h('div', { className: 'bu-empty' }, L.wsEmpty)
                : entries.map(function (w) {
                    var isSel = !!checked[w.id]
                    return h('div', {
                      key: w.id, className: 'bu-row' + (isSel ? ' sel' : ''),
                      onClick: function () { if (!running) toggle(w.id, !isSel) },
                    },
                      h('input', { type: 'checkbox', checked: isSel, disabled: running, onClick: function (e) { e.stopPropagation() }, onChange: function (e) { toggle(w.id, e.target.checked) } }),
                      h('div', { className: 'bu-info' },
                        h('div', { className: 'bu-name' }, w.title || w.path),
                        h('div', { className: 'bu-desc', title: w.path }, w.path || '')
                      ),
                      h('div', { className: 'bu-meta' },
                        h('div', { className: 'bu-ver' }, w.sessionCount + ' ' + L.wsSessions)
                      )
                    )
                  })
          ),
          log.length > 0 ? h('div', { className: 'bu-log' }, log.map(function (l, i) { return h('div', { key: i, className: l.kind }, l.text) })) : null,
          dialog
            ? h('div', { className: 'bu-mask', onClick: function () { if (!running) setDialog(null) } },
                h('div', { className: 'bu-dialog', onClick: function (e) { e.stopPropagation() } },
                  h('h3', null, '⚠ ' + L.wsConfirmTitle),
                  h('div', { className: 'bu-targets' }, dialog.map(function (w) { return h('div', { key: w.id }, '● ' + (w.title || w.path)) })),
                  h('div', { className: 'bu-warn' }, L.wsConfirmWarn),
                  h('div', { className: 'bu-actions' },
                    h('button', { className: 'bu-btn', onClick: function () { setDialog(null) } }, L.cancel),
                    h('button', { className: 'bu-btn primary', onClick: function () { var ids = dialog.map(function (w) { return w.id }); setDialog(null); doDelete(ids) } }, L.confirm)
                  )
                )
              )
            : null
        )
      }

      // ─────────────────────────────────────────────────────────
      // TrashPanel — restore or permanently empty the trash
      // ─────────────────────────────────────────────────────────
      function TrashPanel() {
        var L = t()
        var itemsSt = useState(null)
        var items = itemsSt[0], setItems = itemsSt[1]
        var checkedSt = useState({})
        var checked = checkedSt[0], setChecked = checkedSt[1]
        var dialogSt = useState(false)
        var dialog = dialogSt[0], setDialog = dialogSt[1]
        var runningSt = useState(false)
        var running = runningSt[0], setRunning = runningSt[1]
        var logSt = useState([])
        var log = logSt[0], setLog = logSt[1]

        var load = useCallback(function () {
          fetch(API_TRASH)
            .then(function (r) { return r.json() })
            .then(function (d) { setItems(d && d.ok ? (d.entries || []) : []) })
            .catch(function () { setItems([]) })
        }, [])
        useEffect(function () { load() }, [load])

        var entries = items || []
        var selectedCount = entries.filter(function (x) { return checked[x.id] }).length

        function toggle(id, on) {
          setChecked(function (prev) {
            var next = Object.assign({}, prev)
            if (on) next[id] = true; else delete next[id]
            return next
          })
        }
        function selectAll() { var n = {}; entries.forEach(function (x) { n[x.id] = true }); setChecked(n) }
        function selectNone() { setChecked({}) }

        function doRestore(ids) {
          setRunning(true); setLog([])
          fetch(API_TRASH_RESTORE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ names: ids }),
          })
            .then(function (r) { return r.json() })
            .then(function (d) {
              var rs = d && d.results || []
              rs.forEach(function (it) {
                if (it.ok) setLog(function (p) { return p.concat([{ kind: 'ok', text: '✓ ' + it.name + ' — ' + L.trashRestored }]) })
                else setLog(function (p) { return p.concat([{ kind: 'err', text: '✗ ' + it.name + ' — ' + (it.error || 'failed') }]) })
              })
              setRunning(false); setChecked({}); load()
            })
            .catch(function (e) { setRunning(false); setLog(function (p) { return p.concat([{ kind: 'err', text: '✗ ' + (e && e.message || e) }]) }) })
        }

        function doEmpty() {
          setRunning(true); setLog([])
          fetch(API_TRASH_EMPTY, { method: 'POST' })
            .then(function (r) { return r.json() })
            .then(function (d) {
              setLog(function (p) { return p.concat([{ kind: 'ok', text: '✓ ' + L.trashEmptyDone + (d && d.removed != null ? ' (' + d.removed + ')' : '') }]) })
              setRunning(false); setChecked({}); load()
            })
            .catch(function (e) { setRunning(false); setLog(function (p) { return p.concat([{ kind: 'err', text: '✗ ' + (e && e.message || e) }]) }) })
        }

        return h('div', { className: 'bu-wrap' },
          h('style', null, CSS),
          h('div', { className: 'bu-head' },
            h('div', { className: 'bu-title' }, h('span', { className: 'geek' }, 'Geek'), ' — ' + L.trashTitle),
            h('div', { className: 'bu-sub' }, L.trashSub + ' · v1.3.0')
          ),
          h('div', { className: 'bu-toolbar' },
            h('span', { className: 'bu-stat' }, h('span', { className: 'bu-k' }, L.total), h('b', null, String(entries.length))),
            h('span', { className: 'bu-stat sel' }, h('span', { className: 'bu-k' }, L.selected), h('b', null, String(selectedCount))),
            h('div', { className: 'bu-spacer' }),
            h('button', { className: 'bu-btn', onClick: load, disabled: running }, L.refresh),
            h('button', { className: 'bu-btn', onClick: selectAll, disabled: running || entries.length === 0 }, L.selectAll),
            h('button', { className: 'bu-btn', onClick: selectNone, disabled: running || selectedCount === 0 }, L.selectNone),
            h('button', { className: 'bu-btn', disabled: running || selectedCount === 0, onClick: function () { doRestore(entries.filter(function (x) { return checked[x.id] }).map(function (x) { return x.id })) } }, L.trashRestore),
            h('button', { className: 'bu-btn primary', disabled: running || entries.length === 0, onClick: function () { setDialog(true) } }, L.trashEmpty)
          ),
          h('div', { className: 'bu-list' },
            items === null
              ? h('div', { className: 'bu-empty' }, L.loading)
              : entries.length === 0
                ? h('div', { className: 'bu-empty' }, L.trashEmptyHint)
                : entries.map(function (x) {
                    var isSel = !!checked[x.id]
                    return h('div', {
                      key: x.id, className: 'bu-row' + (isSel ? ' sel' : ''),
                      onClick: function () { if (!running) toggle(x.id, !isSel) },
                    },
                      h('input', { type: 'checkbox', checked: isSel, disabled: running, onClick: function (e) { e.stopPropagation() }, onChange: function (e) { toggle(x.id, e.target.checked) } }),
                      h('div', { className: 'bu-info' },
                        h('div', { className: 'bu-name' }, x.name || x.id)
                      )
                    )
                  })
          ),
          log.length > 0 ? h('div', { className: 'bu-log' }, log.map(function (l, i) { return h('div', { key: i, className: l.kind }, l.text) })) : null,
          dialog
            ? h('div', { className: 'bu-mask', onClick: function () { if (!running) setDialog(false) } },
                h('div', { className: 'bu-dialog', onClick: function (e) { e.stopPropagation() } },
                  h('h3', null, '⚠ ' + L.trashEmptyTitle),
                  h('div', { className: 'bu-warn' }, L.trashEmptyWarn),
                  h('div', { className: 'bu-actions' },
                    h('button', { className: 'bu-btn', onClick: function () { setDialog(false) } }, L.cancel),
                    h('button', { className: 'bu-btn primary', onClick: function () { setDialog(false); doEmpty() } }, L.confirm)
                  )
                )
              )
            : null
        )
      }

      // ─────────────────────────────────────────────────────────
      // Shell — top-level tab container (Plugins / Workspaces / Trash)
      // ─────────────────────────────────────────────────────────
      function Shell() {
        var L = t()
        var tabSt = useState('plugins')
        var tab = tabSt[0], setTab = tabSt[1]
        var TABS = [
          ['plugins', L.tabPlugins],
          ['workspaces', L.tabWorkspaces],
          ['trash', L.tabTrash],
        ]
        return h('div', { className: 'bu-wrap' },
          h('div', { className: 'bu-tabs' },
            TABS.map(function (tb) {
              return h('button', {
                key: tb[0],
                className: 'bu-tab' + (tab === tb[0] ? ' active' : ''),
                onClick: function () { setTab(tb[0]) },
              }, tb[1])
            })
          ),
          tab === 'plugins' ? h(PluginsPanel)
            : tab === 'workspaces' ? h(WorkspacesPanel)
              : h(TrashPanel)
        )
      }
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

          var off = null

          function registerSection() {
            try {
              off = slots.register({
                name: 'settings.section',
                id: NS,
                order: 45,
                label: function () { return t().nav },
                inject: function () { return {} },
              }, function () {
                return h(Shell)
              })
            } catch (e) {
              console.error('[dsh-batch-uninstall] settings.section register failed', e)
            }
          }

          // The settings DIALOG is what declares `settings.section`; on a cold
          // boot this plugin's apply() can run before the settings UI has
          // declared that seat, and a register() against a slot that does not
          // exist yet is dropped — which is why the page only appeared after
          // toggling the plugin off and on (that re-ran apply() against a live
          // slot). `slots.inject(name, cb)` waits for the seat instead, which
          // is how dshmarket mounts its own condition. Fall back to a direct
          // register when inject is missing, so an older host still works.
          if (typeof slots.inject === 'function') {
            slots.inject('settings.section', function () { registerSection() })
          } else {
            registerSection()
          }

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
