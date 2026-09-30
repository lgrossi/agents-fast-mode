# @luan.sh/pi-skills&nbsp;[<img src="https://pi.luan.sh/icons/pi.svg" width="14" alt="Pi gallery">](https://pi.dev/packages/@luan.sh/pi-skills)&nbsp;[<img src="https://pi.luan.sh/icons/npm.svg" width="14" alt="npm">](https://www.npmjs.com/package/@luan.sh/pi-skills)

`@luan.sh/pi-skills` adds a `skill` tool to Pi. The tool loads a skill's `SKILL.md`
into the conversation by exact name, so the model can pull in detailed
instructions only when a task needs them. The package also lists available
skills in the developer prompt, autocompletes `$skill` references in the
editor, and shows loaded skills as compact rows in the transcript.

## Preview

![@luan.sh/pi-skills in Bootty](https://pi.luan.sh/media/previews/pi-skills-024c32055582.png)

[Watch the demo](https://pi.luan.sh/media/previews/pi-skills-b834329672d2.mp4).

## Install

```sh
pi install npm:@luan.sh/pi-skills
```

Optional companions:

- `pi install npm:@luan.sh/pi-xsettings` adds the `/xsettings` editor for the
  setting listed below; without it the default applies.
- `pi install npm:@luan.sh/pi-developer-messages` renders the skill catalogue
  into the developer prompt; without it the catalogue contribution is
  registered but nothing displays it.
- `pi install npm:@luan.sh/pi-custom-editor` renders known `$skill` references
  in the editor as pills; without it they stay plain text while typing.

## How skills are discovered

At session start the package builds a map of skill name to `SKILL.md` path from
three sources, first match per name wins:

1. Skills Pi has already loaded. Pi exposes each as a command named
   `skill:<name>` with source `skill`; the suffix becomes the tool name.
2. `.pi/skills/` under the current directory, only when the project is trusted.
3. `.agents/skills/` in the current directory and every ancestor up to the
   first directory containing `.git` (or the filesystem root). Each
   `.agents/skills/` tree is walked recursively; a directory containing
   `SKILL.md` is a skill. Hidden entries and `node_modules` are skipped;
   symlinked directories are followed once. Only `SKILL.md` files count here,
   not loose Markdown files.

The tool cannot load a skill by arbitrary path. If the name is not in the map,
the call fails with `Unknown skill "<name>"`.

## Load a skill

Call the tool with the exact name:

```json
{ "name": "writing-for-agents" }
```

The tool reads the `SKILL.md`, removes YAML frontmatter, and sends the body to
Pi as a steering message with custom type `@luan.sh/pi-skills/loaded`:

```xml
<skill>
<name>writing-for-agents</name>
<path>/absolute/path/to/SKILL.md</path>
<!-- SKILL.md body without frontmatter -->
</skill>
```

That message reaches the model as user context and stays in the session
history, so later turns can follow it without loading the skill again. The
tool result itself is the one-line text `Loaded skill "<name>".` plus a
`details` object (`version: 1`) with `name`, `requestedName`, `filePath`,
`directory`, `hasSupportingFiles`, `supportingFiles`,
`supportingFilesTruncated`, `frontmatterRemoved`, `sourceChars`,
`loadedChars`, `loadedTokens`, and `instructions`.

### Frontmatter

If `SKILL.md` starts with `---`, everything up to and including the next line
beginning with `---` is dropped. A file with an opening delimiter but no
closing one is sent unchanged.

### Supporting files

The loader walks the skill directory recursively and records relative paths of
every file except `SKILL.md` and `agents/openai.yaml`. At most 256 paths are
recorded; `supportingFilesTruncated` is `true` when more exist. File contents
are never read or appended.

When at least one supporting file exists, the body ends with:

```text
Skill directory: /absolute/path/to/skill
```

The line is omitted when `SKILL.md` is alone or when `agents/openai.yaml` is
the only companion. Use the directory to open scripts, assets, or references
yourself.

## Codemode

Pi 0.99's built-in codemode calls the registered `skill` tool with
`tools.skill({ name })`. Both direct and nested calls deliver the loaded
instructions through the same contextual message.

## Prompt catalogue

When skills exist that Pi allows the model to invoke, the package contributes
a `<skills_instructions>` block (priority 50) listing each skill's name and
description, plus short rules: use the smallest set of skills, call
`tools.skill` with the exact name inside `codemode` before acting, load only the
supporting files the task needs. Skill filesystem paths are never included.
Skills flagged `disableModelInvocation` are omitted.

## Settings

Namespace `@luan.sh/pi-skills`. Edited via `/xsettings` when `@luan.sh/pi-xsettings` is
installed; otherwise the default applies.

| Key | Default | Meaning |
| --- | --- | --- |
| `catalogVisibility` | `when-active` | `when-active`: include the catalogue when `skill` or `codemode` is an active tool. `always`: include it in every prompt. `off`: never include it. |

## Transcript rendering

The steering message is hidden from the transcript. The tool call renders as a
single row: a lightbulb marker, `Skill`, the skill name, and an estimated token
count (`123 tokens` or `1.2k tokens`). Expanding the row shows the loaded body
as Markdown; collapsing hides it again. Failures render as `Skill failed` with
the error text.

In submitted user messages, `$name` tokens that match a discovered skill are
drawn as pills labelled with the skill's display name. References inside inline
or fenced Markdown code stay literal. Pills are painted before native selection
and overlays, so opening another UI does not remove their colors.

## Editor autocomplete

Type `$` at the start of the input or after whitespace to list discovered
skills; continue typing to filter by substring, case-insensitive. Accepting a
suggestion replaces the `$query` token with `$name` and keeps any text after
the cursor. Each item shows the skill description in muted text when the skill
has one.

Pill labels come from `interface.display_name` in the skill's
`agents/openai.yaml` when present (plain or quoted scalars only), otherwise the
skill name. A missing or unreadable file never prevents loading.

This package registers no keyboard actions.

## Layout

| Responsibility | File |
| --- | --- |
| Pi registration and lifecycle | `src/extension.ts` |
| Skill discovery, frontmatter, supporting files, display names | `src/skills.ts` |
| `skill` tool schema, execution, and result details | `src/tools/skill/definition.ts` |
| Transcript row rendering | `src/tools/skill/presentation.ts` |
| Steering message wrapper | `src/loaded-skill-context.ts` |
| Developer prompt catalogue | `src/prompt.ts` |
| Settings declaration | `src/contributions/xsettings.ts` |
| Optional editor pills | `src/contributions/editor-highlights.ts` |
| `$skill` autocomplete | `src/ui/autocomplete.ts` |
| Transcript pills for user messages | `src/ui/transcript-skills.ts` |
| Public exports | `src/index.ts` |

## Troubleshooting

- **Unknown skill:** the name must match a `skill:<name>` command or a
  discovered `SKILL.md` exactly, including case and punctuation.
- **No catalogue in the prompt:** check `catalogVisibility`, make sure `skill`
  or `codemode` is active when it is `when-active`, and install
  `@luan.sh/pi-developer-messages`.
- **Loaded text not visible:** expand the skill row; the text is already in
  model context.

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-skills. Run `bun run typecheck` and
`bun test test` in that directory.
