# Pi package names

All Pi packages are published under `@luan.sh`. Bare names we own remain
supported aliases and continue receiving releases. Install either name for a
package, not both. Versions are independent per package.

| Former name | Canonical name | Bare alias |
| --- | --- | --- |
| `pi-codex-native` | `@luan.sh/pi-codex-native` | `pi-codex-native` |
| `pi-collapse-transcript` | `@luan.sh/pi-collapse-transcript` | `pi-collapse-transcript` |
| `pi-copy-mode` | `@luan.sh/pi-copy-mode` | `pi-copy-mode` |
| `pi-custom-editor` | `@luan.sh/pi-custom-editor` | `pi-custom-editor` |
| `pi-developer-messages` | `@luan.sh/pi-developer-messages` | `pi-developer-messages` |
| `pi-exec-command` | `@luan.sh/pi-exec-command` | `pi-exec-command` |
| `pi-fileops` | `@luan.sh/pi-fileops` | `pi-fileops` |
| `pi-libactions` | `@luan.sh/pi-libactions` | `pi-libactions` |
| `pi-libtui` | `@luan.sh/pi-libtui` | `pi-libtui` |
| `pi-panels` | `@luan.sh/pi-panels` | `pi-panels` |
| `pi-prompt-storage` | `@luan.sh/pi-prompt-storage` | `pi-prompt-storage` |
| `pi-side` | `@luan.sh/pi-side` | `pi-side` |
| `@cfcluan/pi-skills` | `@luan.sh/pi-skills` | — |
| `@cfcluan/pi-subagents` | `@luan.sh/pi-subagents` | — |
| `pi-thinking-binding` | `@luan.sh/pi-thinking-binding` | `pi-thinking-binding` |
| `@cfcluan/pi-tuicr` | `@luan.sh/pi-tuicr` | — |
| `pi-view-image` | `@luan.sh/pi-view-image` | `pi-view-image` |
| `pi-xsettings` | `@luan.sh/pi-xsettings` | `pi-xsettings` |

The former `@cfcluan` publications are deprecated after the new packages are
verified. The retired `@luan-pi` publications are removed after migration.
Existing bare-name installations keep working and do not need to switch.

For an installation using a retired scope, install the replacement before
removing the old entry, then restart Pi:

```sh
pi install npm:@luan.sh/pi-skills
pi remove npm:@cfcluan/pi-skills
```

Former `@luan-pi` names map to the canonical package with the same basename,
with these exceptions:

| Retired package | Replacement |
| --- | --- |
| `@luan-pi/pi-annotations` | `@luan.sh/pi-copy-mode` |
| `@luan-pi/pi-apply-patch` | `@luan.sh/pi-fileops` |
| `@luan-pi/pi-developer-prompt` | `@luan.sh/pi-developer-messages` |
| `@luan-pi/pi-side-chat` | `@luan.sh/pi-side` |
| `@luan-pi/pi-side-panel` | `@luan.sh/pi-panels` |
| `@luan-pi/pi-transcript` | `@luan.sh/pi-collapse-transcript` |

Library consumers can use the canonical `@luan.sh` imports. The supported
bare library names remain available. Settings, action IDs, tool names, and
cross-extension registry keys keep their existing identities.

## Retired repository-wide release tags

Preview media is served from `pi.luan.sh`; native builds use a source commit
recorded in each package. Update older installed or pinned packages before
using versions that depended on repository-wide `v0.3.x` tags or GitHub release
media. Those old references are retired after replacement versions are available.
