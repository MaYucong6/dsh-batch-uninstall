# awesome-dsh-plugin 收录条目

提交目标：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
目标路径：`data/plugins/MaYucong6__dsh-batch-uninstall.yml`

## 提交前提（CI 硬性检查）

1. **仓库创建满 1 天** — 本仓库创建于 `2026-10-16T04:06:08Z`，
   满 1 天的时间点是 **`2026-10-17T04:06:08Z`**（北京时间 2026-10-17 12:06）。
2. `package.json` 声明 `dsh.bundle` ✅ 已满足
3. 仓库有真实可用代码 ✅ 已满足
4. 仓库带 `dsh-plugin` topic ✅ 已满足

## 提交步骤

```bash
# 1. 在 GitHub 上 fork：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork

# 2. 克隆自己的 fork
git clone git@github.com:MaYucong6/awesome-dsh-plugin.git
cd awesome-dsh-plugin

# 3. 把下面的 YAML 存为 data/plugins/MaYucong6__dsh-batch-uninstall.yml
#    （内容见本文件末尾）

# 4. 提交并推送
git checkout -b add/MaYucong6-dsh-batch-uninstall
git add data/plugins/MaYucong6__dsh-batch-uninstall.yml
git commit -m "Add MaYucong6/dsh-batch-uninstall"
git push origin add/MaYucong6-dsh-batch-uninstall

# 5. 在 GitHub 上打开 PR（页面会给出 Compare & pull request 按钮）
```

## 注意事项

- **只添加这一个文件**，不要手工编辑 README.md / README.zh.md（它们由脚本从 `data/plugins/*.yml` 生成）
- 描述中含 `: ` 时必须加引号（本条目已正确加引号）
- 一个 PR 最多 3 条（我们只提 1 条）

## 条目内容

```yaml
url: https://github.com/MaYucong6/dsh-batch-uninstall
name: MaYucong6/dsh-batch-uninstall
category: market
description:
  en: 'Adds a Batch Uninstall page to the DSH settings dialog: a checklist of every installed bundle with multi-select, select-all, a confirmation dialog and per-plugin progress, where official bundles stay locked and each removal goes through the host pluginManager service.'
  zh: '在 DSH 设置中新增「批量卸载」页面：勾选多个已安装插件批量移除，支持全选、二次确认与逐条进度，官方 bundle 自动锁定，删除统一走宿主 pluginManager 服务。'
```
