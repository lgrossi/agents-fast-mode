import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
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
