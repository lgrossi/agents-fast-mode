import type { Theme } from "@earendil-works/pi-coding-agent";
import { markdownCodeRanges, renderTranscriptPill } from "@luan.sh/pi-libtui";
import { fileIcon } from "../core/file-icons.ts";
import { atReferences } from "../core/highlights.ts";

export function projectFileTranscript(markdown: string, width: number, theme: Theme): string {
	const lines = markdown.split("\n");
	const excluded = markdownCodeRanges(lines);
	return lines
		.map((line, row) => {
			let projected = line;
			for (const reference of atReferences(line).reverse()) {
				if (excluded[row]?.some((range) => reference.start < range.end && range.start < reference.end)) continue;
				const icon = fileIcon(reference.path, false);
				projected =
					projected.slice(0, reference.start) +
					renderTranscriptPill(
						theme,
						{ label: reference.path, icon: { glyph: icon.glyph }, iconTone: icon.tone },
						width,
					) +
					projected.slice(reference.end);
			}
			return projected;
		})
		.join("\n");
}
