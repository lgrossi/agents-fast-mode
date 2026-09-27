import { expect, test } from "bun:test";
import { initTheme, type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, TruncatedText, visibleWidth } from "@earendil-works/pi-tui";
import { installPendingMessageTransformer } from "@luan.sh/pi-libtui";
import { imagePreviewMarker, imagePreviewTargets } from "../src/runtime/image-preview.ts";
import { projectImageTranscript } from "../src/runtime/transcript-attachments.ts";

const theme = {
	getColorMode: () => "truecolor",
	getFgAnsi: () => "\x1b[38;2;220;220;220m",
	getBgAnsi: () => "\x1b[48;2;30;34;42m",
} as never as Theme;

test("projects submitted images in order without depending on pending editor state", () => {
	const source = '<file name="/a long path/screenshot.png"></file>\ncompare <file name="/tmp/two.webp"></file> please';
	const projected = projectImageTranscript(source, 80, theme).replaceAll("\u00a0", " ");
	expect(projected).toContain("Image #1");
	expect(projected).toContain("Image #2");
	expect(projected).toContain("please");
	expect(projected).not.toContain("<file");
});

test("leaves code and non-image attachments literal", () => {
	const source =
		'`<file name="x.png"></file>`\n```xml\n<file name="x.png"></file>\n```\n<file name="notes.txt">notes</file>';
	expect(projectImageTranscript(source, 80, theme)).toBe(source);
});

test("queued images project before native truncation, restore dim text, and do not change the queue", () => {
	const source = '<file name="/a very long directory/screen &amp; one.png"></file> after';
	const message = new TruncatedText(`Steering: ${source}`, 1, 0);
	const dispose = installPendingMessageTransformer((text, width) => projectImageTranscript(text, width, theme, true));
	try {
		for (const prefix of ["Steering", "Follow-up"]) {
			const rendered = new TruncatedText(`${prefix}: ${source}`, 1, 0).render(40);
			expect(stripTerminalSequences(rendered[0]!).replaceAll("\u00a0", " ")).toContain("Image #1");
			expect(visibleWidth(rendered[0]!)).toBe(40);
			expect(imagePreviewTargets(rendered)[0]?.id).toBe("/a very long directory/screen & one.png");
		}
		expect(message.render(40)[0]).not.toContain("<file");
	} finally {
		dispose();
	}
	expect(message.render(200)[0]).toContain(source);
});

test("hover identity survives native Markdown and distinguishes repeated labels", () => {
	initTheme("dark", false);
	const render = (path: string) =>
		new UserMessageComponent(`<file name="${path}"></file>\ntext after the pill`, undefined, 1, [
			(text, context) => projectImageTranscript(text, context.availableWidth, theme),
		]).render(40);
	const targets = imagePreviewTargets([...render("/one.png"), ...render("/two.png")]);
	expect(targets.map((target) => target.id)).toEqual(["/one.png", "/two.png"]);
	expect(targets.every((target) => target.rect.width > 0 && target.rect.width < 40)).toBe(true);
	// A clipped opener is not a usable hit target; malformed metadata cannot abort a frame.
	expect(
		imagePreviewTargets([
			imagePreviewMarker("pill", "/one.png").slice(0, -3),
			"\x1b]pi-image:%bad\x07x\x1b]pi-image:\x07",
		]),
	).toEqual([]);
});
