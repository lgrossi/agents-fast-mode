import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderTranscriptPill, markdownCodeRanges } from "@luan.sh/pi-libtui";
import { VIEW_IMAGE_PILL_IDENTITY } from "../core/appearance.ts";

/** Display-only projection; the stored file tags and provider attachments stay intact. */
export function projectImageTranscript(markdown: string, width: number, theme: Theme): string {
	const lines = markdown.split("\n");
	const excluded = markdownCodeRanges(lines);
	let image = 0;
	return lines
		.map((line, row) =>
			line.replace(/<file name="[^"\r\n]+\.(?:bmp|gif|jpe?g|png|webp)">[^\r\n]*?<\/file>/gi, (tag, offset: number) => {
				if (excluded[row]?.some((range) => offset < range.end && range.start < offset + tag.length)) return tag;
				return renderTranscriptPill(theme, { ...VIEW_IMAGE_PILL_IDENTITY, label: `Image #${++image}` }, width);
			}),
		)
		.join("\n");
}
