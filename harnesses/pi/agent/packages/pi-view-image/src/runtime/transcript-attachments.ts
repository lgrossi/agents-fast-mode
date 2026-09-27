import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderTranscriptPill, markdownCodeRanges } from "@luan.sh/pi-libtui";
import { VIEW_IMAGE_PILL_IDENTITY } from "../core/appearance.ts";
import { decodeAttachmentPath } from "../core/attachments.ts";
import { imagePreviewMarker } from "./image-preview.ts";

/** Display-only projection; the stored file tags and provider attachments stay intact. */
export function projectImageTranscript(markdown: string, width: number, theme: Theme, muted = false): string {
	const lines = markdown.split("\n");
	const excluded = markdownCodeRanges(lines);
	let image = 0;
	return lines
		.map((line, row) =>
			line.replace(
				/<file name="([^"\r\n]+\.(?:bmp|gif|jpe?g|png|webp))">[^\r\n]*?<\/file>/gi,
				(tag, path: string, offset: number) => {
					if (excluded[row]?.some((range) => offset < range.end && range.start < offset + tag.length)) return tag;
					return imagePreviewMarker(
						renderTranscriptPill(theme, { ...VIEW_IMAGE_PILL_IDENTITY, label: `Image #${++image}` }, width, muted),
						decodeAttachmentPath(path),
					);
				},
			),
		)
		.join("\n");
}
