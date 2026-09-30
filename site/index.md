# Luan's Pi extensions

Documentation for the Pi extensions, shared libraries, and native tools kept in
[luan/agents](https://github.com/luan/agents). Each package page is that
package's README: installation, settings, tools, keybindings, and the layout of
its source. The repository pages describe the architecture every package
follows.

## Install

Every package installs on its own with Pi's package manager:

```sh
pi install npm:<package>
```

Packages that use a native binary require a Rust toolchain
(https://rustup.rs). The binary builds on first use under Pi's agent
directory; each package page names the binary and the environment variable
that points Pi at a prebuilt one instead.

Run `/reload` after changing package loading, keybindings, or a setting
documented as reload-only.

## Extensions

<!-- extensions -->

## Libraries

Library packages register no Pi extension by themselves. `@luan.sh/pi-libtui` is the one
dual-role package: imports expose reusable components without side effects,
and its extension entry point installs terminal compatibility for Pi.

<!-- libraries -->

## Configuration

Extensions read three files from Pi's agent directory, normally `~/.pi/agent`:

| File | Owns |
| --- | --- |
| `settings.json` | Packages, models, theme, and Pi-owned behavior. |
| `xsettings.toml` | Settings contributed by extensions. Edit interactively with `/xsettings` when [`@luan.sh/pi-xsettings`](/packages/pi-xsettings/) is installed; otherwise each package's compiled defaults apply. |
| `keybindings.json` | Pi bindings and every custom extension action. Extensions ship no default keys for custom actions. |

`pi.defaultTools` selects startup tools. Tool definitions use Pi's public
`exposure` field for direct, model-only, codemode, and deferred access. The
built-in `codemode` and `tool_search` tools own composition and discovery.

## Native tools

TypeScript registers and composes Pi features. Rust owns the process, patch,
and protocol boundaries.

| Crate | Responsibility |
| --- | --- |
| `apply-patch` | Parses and applies structured patches. |
| `terminal-bridge` | Runs bounded pipes and persistent PTY sessions. |
| `web-run` | Executes the native Codex web request contract. |
| `voice-host` | Microphone, speaker, Opus, and WebRTC for voice. |
| `view-image` | Reads local images for Codex-compatible attachment previews. |
