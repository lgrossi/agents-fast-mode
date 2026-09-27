import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { tuiTheme } from "../color/theme.ts";
import { type PillContent, renderPillText } from "./glyphs.ts";
import { contrastingPillBackground, renderPill } from "./powerline-pill.ts";

/** Paint user-message pills before native Markdown, selection, and overlay composition. */
export function renderTranscriptPill(theme: Theme, content: PillContent, width: number, muted = false): string {
	const clean = stripTerminalSequences(content.label).replace(/[\r\n\t]/g, " ");
	const padding = visibleWidth(renderPillText({ ...content, label: "" }));
	const label = truncateToWidth(clean, Math.max(1, width - padding - 1), "…");
	const destination = muted ? "\x1b[49m" : theme.getBgAnsi("userMessageBg");
	const colors = tuiTheme(theme);
	const contrast = contrastingPillBackground(theme, destination);
	const background = colors.mixForeground(colors.contrastBackground(contrast), contrast, 0.2);
	// Pi wraps at ASCII spaces; keep the painted pill together.
	return (
		renderPill(
			theme,
			{ ...content, label, ...(muted ? { iconTone: "text.muted" as const } : {}) },
			background,
			muted ? "text.muted" : "text.primary",
			undefined,
			destination,
		).replaceAll(" ", "\u00a0") + theme.getFgAnsi(muted ? "dim" : "userMessageText")
	);
}
