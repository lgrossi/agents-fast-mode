import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { projectFileTranscript } from "../src/ui/transcript-files.ts";

const theme = {
	getColorMode: () => "truecolor",
	getFgAnsi: () => "\x1b[38;2;220;220;220m",
	getBgAnsi: () => "\x1b[48;2;30;34;42m",
} as never as Theme;

test("projects quoted paths and leaves code alone", () => {
	const result = stripTerminalSequences(
		projectFileTranscript('read @src/main.rs and @"some path/file.ts"\n`@literal`\n```\n@literal\n```', 80, theme),
	).replaceAll("\u00a0", " ");
	expect(result).toContain("src/main.rs");
	expect(result).toContain("some path/file.ts");
	expect(result).not.toContain("@src");
	expect(result).toContain("`@literal`\n```\n@literal\n```");
});
