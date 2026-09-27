import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { SkillReference } from "../src/skills.ts";
import { projectSkillTranscript } from "../src/ui/transcript-skills.ts";

const skills = new Map<string, SkillReference>([
	["finish", { name: "finish", filePath: "/skills/finish/SKILL.md", displayName: "Finish" }],
]);
const theme = {
	name: "transcript-skill-test",
	getColorMode: () => "truecolor",
	getFgAnsi: () => "\x1b[38;2;180;190;220m",
	getBgAnsi: () => "\x1b[48;2;24;28;36m",
} as never as Theme;

describe("skill transcript pills", () => {
	test("projects known references without retaining the dollar sign", () => {
		const projected = projectSkillTranscript("use $finish now", skills, 80, theme);
		expect(projected).not.toContain("$finish");
		expect(stripTerminalSequences(projected).replaceAll("\u00a0", " ")).toContain("💡 Finish");
	});

	test("leaves inline and fenced code literal", () => {
		const source = ["use `$finish`", "```", "$finish", "```", "then $finish"].join("\n");
		const projected = projectSkillTranscript(source, skills, 80, theme);
		expect(projected.split("\n").slice(0, 4).join("\n")).toBe(["use `$finish`", "```", "$finish", "```"].join("\n"));
		expect(projected).toContain("Finish");
	});
});
