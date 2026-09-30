# @luan.sh/pi-fileops&nbsp;[<img src="https://pi.luan.sh/icons/pi.svg" width="14" alt="Pi gallery">](https://pi.dev/packages/@luan.sh/pi-fileops)&nbsp;[<img src="https://pi.luan.sh/icons/npm.svg" width="14" alt="npm">](https://www.npmjs.com/package/@luan.sh/pi-fileops)

`@luan.sh/pi-fileops` adds an `apply_patch` tool to Pi. The model writes a
Codex-style patch (`*** Begin Patch` ... `*** End Patch`) and a native Rust
binary applies it: parsing, context matching, filesystem writes, and
partial-failure tracking. The same operation is available as a direct Pi tool
and as `tools.apply_patch({ input })` inside Pi's built-in `codemode`.

## Preview

![@luan.sh/pi-fileops in Bootty](https://pi.luan.sh/media/previews/pi-fileops-fd6d191a4760.png)

[Watch the demo](https://pi.luan.sh/media/previews/pi-fileops-fcf6128b5f4c.mp4).

## Install

```sh
pi install npm:@luan.sh/pi-fileops
```

Requires a Rust toolchain (<https://rustup.rs>). The `apply-patch` binary builds
itself on first use under Pi's agent directory (`native/apply-patch/<version>/`).
Set `PI_APPLY_PATCH_BIN` to use a prebuilt binary.

## Direct and codemode calls

Pi 0.99's built-in codemode calls the registered tool through
`tools.apply_patch({ input: "...patch text..." })`. Direct model calls use
native freeform grammar input. Both paths share validation, file mutation
queues, execution, and policy hooks. Partial failures preserve successful
edits and mark the result as an error.

## Patch format

Every input starts and ends with the patch markers. Use one action header per
file:

```text
*** Begin Patch
*** Add File: notes/today.txt
+A new file.
*** Update File: src/main.ts
@@
-old line
+new line
*** Delete File: obsolete.txt
*** End Patch
```

Supported actions are `Add File`, `Update File`, `Delete File`, and `Move to`.
Put `*** Move to: ...` immediately after an `*** Update File: ...` header.
Order multiple hunks for one file from top to bottom. Context and indentation
are literal text. Every line of an `Add File` body must start with `+`.

Paths are resolved relative to the Pi session cwd. Absolute paths are passed
through unchanged. A leading `@` and surrounding quotes are stripped from
paths for compatibility with Pi path arguments.

The direct tool accepts `input`; the aliases `patchText` and `patch` are
normalized to `input` before execution.

## Execution and results

The Rust binary owns parsing, matching, filesystem mutations, and partial
failure tracking. The TypeScript side owns Pi registration, argument
normalization, per-file mutation queues, process control, and result shaping.

Before running, the tool takes Pi's file mutation queue for every path the
patch touches (including move targets), so concurrent edits to the same file
are serialized. The binary is spawned with the patch on stdin and
`PI_APPLY_PATCH_JSON=1`; its final stdout line is the structured result.

A successful result reports changed, created, deleted, and moved files, fuzz,
and the committed unified diff. While queued or running, the transcript shows a
preview built from the input patch; once complete, it renders the native diff,
so line ranges describe the files actually written.

If an early action succeeds and a later one fails, the tool returns a
`partial_failure` result listing the committed prefix and the failed targets.
The text result tells the model to re-read failed files before retrying and
not to reapply successful actions. A `tool_result` hook marks direct
partial-failure results as errors. If nothing was committed, the tool throws
with the binary's diagnostic (bounded to 8 KiB).

The direct tool declares a Lark grammar as constrained sampling, so providers
that support native freeform tools receive the raw patch text. Other providers
receive the ordinary `{ input: string }` function schema.

## Settings and keybindings

This package has no settings and registers no commands or key-bound actions.
Its only configuration is the `PI_APPLY_PATCH_BIN` environment variable.

## API

The default export of `src/extension.ts` is the Pi extension. `src/index.ts`
exports:

- `createApplyPatchTool()` and `registerApplyPatchTool(pi, tool?)` for Pi
  registration.
- `executePatchWithRust({ cwd, patchText, signal?, binary? })` for the native
  execution boundary; it throws `ExecutePatchError` on failure.
- `resolveApplyPatchBinary()` for the default/override binary lookup.
- `createApplyPatchRunningResult`, `createApplyPatchSuccessResult`, and
  `createApplyPatchPartialFailureResult` for building tool results.
- Types `ApplyPatchToolDetails`, `ApplyPatchOperation`, `ApplyPatchFileResult`,
  `ApplyPatchRunningDetails`, `ApplyPatchSuccessDetails`,
  `ApplyPatchPartialFailureDetails`, and `ExecutePatchResult`.

Result details are `version: 1` and JSON-serializable. Every status carries
`input.operations`, `affectedPaths`, `files` (per-file `applied`/`failed`),
`counts`, `progress`, and `timing.durationMs`. `success` and `partial_failure`
add `result` (the native result); `partial_failure` adds
`failure.{message, failedTargets}`.

## Layout

| Responsibility | File |
| --- | --- |
| Extension entry: registers tool and result hook | `src/extension.ts` |
| Tool definition, argument normalization, mutation queues | `src/tools/apply-patch/definition.ts` |
| Result shaping and details types | `src/tools/apply-patch/result.ts` |
| Transcript rendering (input preview, native diff) | `src/tools/apply-patch/presentation.ts` |
| Spawning the native binary and parsing its JSON | `src/executor.ts` |
| Binary lookup and first-use build | `src/binary.ts` |
| TypeScript patch parsing for previews and path resolution | `src/patch.ts` |
| Lark grammar for freeform providers | `src/grammar.ts` |
| Shared types and `ExecutePatchError` | `src/types.ts` |
| Public exports | `src/index.ts` |

## Troubleshooting

- **Binary fails to build:** make sure `cargo` is installed and on `PATH`, or
  set `PI_APPLY_PATCH_BIN` to an executable file.
- **The tool is missing entirely:** include `apply_patch` in Pi's active tool
  selection. Built-in codemode can call active direct tools.
- **A patch partially failed:** preserve the successful edits, read each
  failed target again, and retry only the failed actions.
- **A patch is rejected:** check the begin/end markers, action headers, exact
  context lines, and the required `+` prefix for added-file content.

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-fileops. Run `bun run typecheck` and
`bun test test` in that directory.
