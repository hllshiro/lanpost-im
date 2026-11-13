# 发布与版本说明

更新：2026-11-13

范围：`.github/workflows/build.yml` 的 `release` job 与打标签流程。改这里之前先看 `.github/workflows/build.yml` 现状。

## 触发条件

- 只有推送 `v*` 标签，或手动 `workflow_dispatch`，才会启动构建。
- `release` job 只在标签触发时运行（`if: startsWith(github.ref, 'refs/tags/v')`），必须等 `windows`、`linux` 两个 job 全部成功。
- 手动 dispatch 只产出构建产物（artifact），不会创建 GitHub Release。

## 标签必须是 annotated tag

Release 正文的第一段来自标签消息，所以打标签时必须用 `-a` 写内容，不能用轻量标签：

```bash
git tag -a v0.6.0 -m "消息撤回与正在输入提示" -m "- 支持撤回自己与对方的消息
- 会话内显示“正在输入”
- 修复合并联系人后的头像错位"
git push origin v0.6.0
```

- 第一个 `-m` 写一句话概括，第二个 `-m` 写要点；整段标签消息会原样成为 Release 正文的开头。
- 轻量标签（`git tag v0.6.0`，不带 `-a`）没有独立消息，Release 只会显示自动生成的内容，等同于旧行为。
- 标签只认已存在的 annotated tag；工作流不会替你补写标签。

## Release 正文的组成

```
<标签消息>

## What's Changed
...

**Full Changelog**: https://github.com/hllshiro/lanpost-im/compare/v0.5.0...v0.6.0
```

`release` job 的执行顺序：

1. `actions/checkout@v4` 取出标签提交；因为它用 `--depth=1 --no-tags`，annotated tag 对象本身不会下载，仓库里的 `refs/tags/vX` 只是一个指向提交的普通引用。
2. `Read tag message` 先 `git fetch --force origin refs/tags/$GITHUB_REF_NAME:refs/tags/$GITHUB_REF_NAME` 把标签对象补下来，再用 `git tag -l --format='%(contents)'` 把标签消息写入 `release-notes.md`；非 annotated tag 时写入空文件。
3. `actions/download-artifact@v4` 汇总三个平台的安装包。
4. `softprops/action-gh-release@v2` 用 `body_path: release-notes.md` 提交手写内容，同时保留 `generate_release_notes: true`，GitHub 会把自动笔记（含 “Full Changelog” 对比链接）拼在正文后面。

空文件不会报错，此时正文只有自动笔记，不会出现空白页面。

## 修改或重发

- 标签已推送、Release 已生成后要改内容：修正本地标签（`git tag -f -a ...`）并强推 `git push --force origin v0.6.0`，工作流会重新构建并更新同一个 Release。
- 只是正文写错、不想重新打包，可以直接在网页上编辑 Release 正文；下次标签重推会被工作流覆盖。
- 删除 Release 不影响标签；删除标签不会自动删除 Release。

## 校验

发布前在本地确认标签消息：

```bash
git tag -l --format='%(contents)' v0.6.0
```

发布后确认正文首段是手写内容、末尾仍有 Full Changelog：

```bash
curl -s https://api.github.com/repos/hllshiro/lanpost-im/releases/tags/v0.6.0 | grep -m1 '"body"'
```
