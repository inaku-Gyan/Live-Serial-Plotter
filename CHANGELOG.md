# Changelog

## 0.1.2

- Rewrite the Profiles & Pipeline sidebar UI with Vue 3 while keeping the monitor page on the existing high-performance uPlot path.
- Improve sidebar profile interactions with a home list, per-profile action menus, editor-only JSONC access, and scope-aware builtin/user/workspace behavior.
- Fix profile autosave issues, including stale values after refresh and Webview `DataCloneError` when posting reactive draft objects.
- Add Vue component/store tests for profile selection, action menus, readonly builtin profiles, autosave, and copy/open JSONC flows.
- Configure stricter Oxlint rules, including type-aware checks, and clean up the resulting source and test warnings.

## 0.1.1

- Add JSONC profiles, configurable pipeline stages, output packets, and batched Webview updates.
- Add the Profiles & Pipeline sidebar editor for basic profile configuration and JSONC access.
- Split runtime serial connection settings from profiles, and introduce schema v2 text codec configuration.
- Namespace profile ids by builtin, user, and each workspace folder; sidebar edits now auto-save user/workspace profiles and use Copy for new profiles.
- Add builtin parser options, stateful parsing support, and guarded workspace `.mjs` script parsers.

## 0.1.0

- Initial MVP scaffold for serial monitoring, parsing, and live plotting.
