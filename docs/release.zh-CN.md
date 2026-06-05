# 发布流程

本项目采用 tag-driven release：本地只负责验证、改版本和打 tag，正式
打包、发布 GitHub Release 和发布 VS Code Marketplace 都由 GitHub
Actions 完成。

## 版本和渠道

VS Code Marketplace 的扩展版本只支持 `MAJOR.MINOR.PATCH`，例如
`0.2.0`。不要使用 `0.3.0-alpha.1`、`0.3.0+build.1` 这类 SemVer
后缀；这些格式不能作为 VS Code 扩展发布版本。

Git tag 必须是 `vMAJOR.MINOR.PATCH`，并且去掉 `v` 后必须和
`package.json` 里的 `version` 完全一致。

本项目用 minor 奇偶区分渠道：

- `0.2.x`：stable
- `0.3.x`：prerelease
- `0.4.x`：stable
- `0.5.x`：prerelease

release workflow 会根据 `package.json.version` 的 minor 自动决定
是否给 `vsce package` 和 `vsce publish` 传 `--pre-release`。

## 本地发布前检查

发布前先在本地完成基础验证：

```sh
pnpm check
pnpm package
```

建议再安装生成的 VSIX 做一次 smoke test，确认扩展能激活、命令能打开、
Webview 能显示，并且串口 native binding 没有加载错误。

也可以手动检查 prerelease VSIX 的 manifest 标记：

```sh
pnpm exec vsce package --pre-release --no-dependencies --allow-missing-repository --out /tmp/live-serial-plotter-prerelease.vsix
unzip -p /tmp/live-serial-plotter-prerelease.vsix extension.vsixmanifest | rg 'Microsoft.VisualStudio.Code.PreRelease" Value="true"'
```

正式发布包应不包含这个 `PreRelease` 标记。

## 正式发布步骤

1. 修改 `package.json` 的 `version`。
2. 更新 `CHANGELOG.md`。
3. 运行本地检查和 smoke test。
4. 提交版本变更。
5. 给同一个 commit 打 tag，例如：

```sh
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

推送 tag 后，`.github/workflows/release.yml` 会自动：

- 校验 tag 格式和 `package.json.version` 是否一致。
- 运行 CI。
- 分平台打包 VSIX：`linux-x64`、`darwin-x64`、`darwin-arm64`、`win32-x64`。
- 检查 prerelease/stable manifest 标记是否正确。
- 创建 GitHub Release 并上传 VSIX。
- 在配置 `VSCE_PAT` 后发布到 VS Code Marketplace。

Marketplace 发布 job 绑定 `marketplace-production` environment。建议在
GitHub 仓库设置里给该 environment 配置 reviewer，这样 tag 推送后仍需
人工批准才会真正发布到 Marketplace。

## 重复发包和失败处理

Marketplace 不能覆盖重发同一个 `version + target`。如果 `0.3.2`
的 `linux-x64` 包已经发布，不能再用同一个版本号替换它；修复后必须
bump patch，例如发布 `0.3.3`。

如果 release workflow 在发布到 Marketplace 之前失败，可以删除本地和远端
tag，修复问题后重新打 tag：

```sh
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
```

如果某个 tag 已经成功发布到 GitHub Release 或 Marketplace，不要
force-push 覆盖该 tag。改代码、bump 版本、重新发布下一个版本。
