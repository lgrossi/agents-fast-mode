import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Image, Text, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { mountHoverPreview, tuiTheme, type HoverPreviewTarget } from "@luan.sh/pi-libtui";
import { ensureMouseRegistry } from "@luan.sh/pi-libtui/mouse";
import { resolveViewImageBinary } from "../native/binary.ts";
import { runViewImageBinary } from "../native/view-image.ts";

const CLOSE = "\x1b]pi-image:\x07";
const MARKER = /\x1b\]pi-image:([^\x07\x1b]+)\x07([\s\S]*?)\x1b\]pi-image:\x07/g;

/** Inert path metadata only: removing it never changes the already-painted pill. */
export function imagePreviewMarker(pill: string, path: string): string {
	// An unrecognized OSC is inert. Unlike APC, BEL terminates it in real terminals;
	// unlike ST, it cannot become a Markdown backslash line break.
	return `\x1b]pi-image:${encodeURIComponent(path)}\x07${pill}${CLOSE}`;
}

export function imagePreviewTargets(screen: readonly string[]): HoverPreviewTarget[] {
	return screen.flatMap((line, y) =>
		[...line.matchAll(MARKER)].flatMap((match) => {
			try {
				return [
					{
						id: decodeURIComponent(match[1]!),
						rect: {
							x: visibleWidth(line.slice(0, match.index)),
							y,
							width: visibleWidth(match[2]!),
							height: 1,
						},
					},
				];
			} catch {
				return [];
			}
		}),
	);
}

export function installImagePreviews(tui: TUI, cwd: string, getTheme: () => Theme): () => void {
	return mountHoverPreview({
		id: "pi-view-image.preview",
		tui,
		registry: ensureMouseRegistry(),
		getTargets: imagePreviewTargets,
		async load(target, size, signal) {
			const colors = tuiTheme(getTheme());
			try {
				// Hover is opportunistic; larger files remain available through the explicit image tool.
				const path = resolve(cwd, target.id);
				if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error("Image is too large for a hover preview");
				signal.throwIfAborted();
				const binary = await resolveViewImageBinary();
				signal.throwIfAborted();
				const image = await runViewImageBinary(binary, { path, detail: "high" }, cwd, signal);
				return new Image(
					image.data,
					image.mimeType,
					{ fallbackColor: (text) => colors.fg("text.muted", text) },
					{
						maxWidthCells: size.width,
						maxHeightCells: size.height,
						filename: basename(path),
					},
					{ widthPx: image.width, heightPx: image.height },
				);
			} catch {
				return new Text(colors.fg("text.muted", "Image preview unavailable"), 0, 0);
			}
		},
	});
}
