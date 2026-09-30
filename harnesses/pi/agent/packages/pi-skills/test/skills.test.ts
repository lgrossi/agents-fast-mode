import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { icon } from "@luan.sh/pi-libtui";
import {
	getDeveloperMessageContributionRegistry,
	renderDeveloperMessages,
} from "../../pi-developer-messages/src/developer-messages.ts";
import { registerSkillsPromptContribution, renderSkillsCatalog } from "../src/prompt.ts";
import { createSkillTool } from "../src/tools/skill/definition.ts";
import { addSkillDisplayNames, discoverSkills, parseSkillDisplayName } from "../src/skills.ts";

interface SentSkillMessage {
	customType: string;
	content: string;
	display: boolean;
	details: object;
}

function skillTool(filePath: string) {
	const sent: Array<{ message: SentSkillMessage; options: { deliverAs: string } }> = [];
	const tool = createSkillTool({
		getCommands: () => [
			{
				name: "skill:writing-for-agents",
				description: "Writing documents for agents.",
				source: "skill",
				sourceInfo: { path: filePath },
			},
		],
		sendMessage: async (message: SentSkillMessage, options: { deliverAs: string }) => {
			sent.push({ message, options });
		},
	} as never);
	return { tool, sent };
}

test("reads the tentative skill label from agents/openai.yaml", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-skills-display-name-"));
	const filePath = join(directory, "SKILL.md");
	mkdirSync(join(directory, "agents"));
	writeFileSync(filePath, "# Write\n");
	writeFileSync(
		join(directory, "agents", "openai.yaml"),
		"interface:\n  display_name: 'Writing for agents'\n  short_description: Write.\n",
	);

	expect(parseSkillDisplayName('interface:\n  display_name: "Writing for agents"\n')).toBe("Writing for agents");
	expect(await addSkillDisplayNames(new Map([["writing", { name: "writing", filePath }]]))).toEqual(
		new Map([["writing", { name: "writing", filePath, displayName: "Writing for agents" }]]),
	);
});

test("falls back when agents/openai.yaml has no supported display name", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-skills-display-name-"));
	const reference = { name: "writing", filePath: join(directory, "SKILL.md") };

	expect(await addSkillDisplayNames(new Map([[reference.name, reference]]))).toEqual(
		new Map([[reference.name, reference]]),
	);
});

test("discovers trusted project skills from .pi and ancestor .agents directories", () => {
	const parent = mkdtempSync(join(tmpdir(), "pi-skills-project-parent-"));
	const root = join(parent, "repo");
	const cwd = join(root, "packages", "app");
	mkdirSync(join(root, ".git"), { recursive: true });
	mkdirSync(cwd, { recursive: true });
	const writeSkill = (directory: string, name: string): string => {
		mkdirSync(directory, { recursive: true });
		const filePath = join(directory, "SKILL.md");
		writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`);
		return filePath;
	};
	const cwdAgents = writeSkill(join(cwd, ".agents", "skills", "cwd-skill"), "cwd-skill");
	const rootAgents = writeSkill(join(root, ".agents", "skills", "root-skill"), "root-skill");
	writeSkill(join(root, "shared-skills", "linked-skill"), "linked-skill");
	const linkedDirectory = join(root, ".agents", "skills", "linked-skill");
	symlinkSync("../../shared-skills/linked-skill", linkedDirectory, "dir");
	const linkedSkill = join(linkedDirectory, "SKILL.md");
	writeFileSync(join(root, ".agents", "skills", ".gitignore"), "/linked-skill\n");
	const cwdPi = writeSkill(join(cwd, ".pi", "skills", "pi-skill"), "pi-skill");
	writeSkill(join(parent, ".agents", "skills", "outside-repo"), "outside-repo");
	writeFileSync(
		join(root, ".agents", "skills", "ignored.md"),
		"---\nname: ignored\ndescription: ignored\n---\nignored\n",
	);
	const pi = { getCommands: () => [] } as never;

	expect(discoverSkills(pi, { cwd, trusted: false })).toEqual(
		new Map([
			["cwd-skill", { name: "cwd-skill", filePath: cwdAgents, description: "cwd-skill" }],
			["root-skill", { name: "root-skill", filePath: rootAgents, description: "root-skill" }],
			["linked-skill", { name: "linked-skill", filePath: linkedSkill, description: "linked-skill" }],
		]),
	);
	expect(discoverSkills(pi, { cwd, trusted: true })).toEqual(
		new Map([
			["pi-skill", { name: "pi-skill", filePath: cwdPi, description: "pi-skill" }],
			["cwd-skill", { name: "cwd-skill", filePath: cwdAgents, description: "cwd-skill" }],
			["root-skill", { name: "root-skill", filePath: rootAgents, description: "root-skill" }],
			["linked-skill", { name: "linked-skill", filePath: linkedSkill, description: "linked-skill" }],
		]),
	);
});

test("loads a skill without frontmatter", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-skills-"));
	const filePath = join(directory, "SKILL.md");
	writeFileSync(filePath, "---\nname: writing-for-agents\ndescription: Write.\n---\n# Write\n\nUse short sentences.\n");

	const { tool, sent } = skillTool(filePath);
	const result = await tool.execute("call", { name: "writing-for-agents" }, undefined, undefined, {} as never);

	expect(result.content).toEqual([{ type: "text", text: 'Loaded skill "writing-for-agents".' }]);
	expect(result.details).toMatchObject({
		version: 1,
		tool: "skill",
		status: "loaded",
		requestedName: "writing-for-agents",
		name: "writing-for-agents",
		filePath,
		directory,
		frontmatterRemoved: true,
		hasSupportingFiles: false,
		supportingFiles: [],
	});
	expect(JSON.parse(JSON.stringify(result.details))).toEqual(result.details);
	const rendered = tool.renderResult!(
		result,
		{ expanded: false, isPartial: false },
		{
			name: "skills-test",
			bold: (text: string) => text,
			getColorMode: () => "truecolor",
			getFgAnsi: () => "\x1b[39m",
			getBgAnsi: () => "\x1b[49m",
		} as never,
		{ invalidate() {}, isError: false } as never,
	) as unknown as {
		render(width: number): string[];
		onMouse?(event: {
			type: "move" | "press" | "release";
			row: number;
			col: number;
			screenRow: number;
			screenCol: number;
			button: 0 | 2;
			wheel: undefined;
			shift: false;
			alt: false;
			ctrl: false;
		}): boolean;
	};
	const compact = rendered.render(80).join("\n");
	expect(Bun.stripANSI(compact)).not.toContain("# Write");
	expect(Bun.stripANSI(compact).split("\n")).toHaveLength(1);
	expect(Bun.stripANSI(compact)).toContain("💡 Skill · writing-for-agents · 8 tokens");
	const pointer = {
		row: 0,
		col: 79,
		screenRow: 0,
		screenCol: 79,
		button: 0 as const,
		wheel: undefined,
		shift: false as const,
		alt: false as const,
		ctrl: false as const,
	};
	expect(rendered.onMouse?.({ ...pointer, type: "move" })).toBe(true);
	const hovered = rendered.render(80).join("\n");
	expect(Bun.stripANSI(hovered).trimEnd()).toBe(Bun.stripANSI(compact).trimEnd());
	expect(hovered).not.toBe(compact);
	expect(rendered.onMouse?.({ ...pointer, type: "press" })).toBe(true);
	expect(rendered.onMouse?.({ ...pointer, type: "release" })).toBe(true);
	const expandedSkill = Bun.stripANSI(rendered.render(80).join("\n"));
	expect(expandedSkill).toContain("💡 Skill · writing-for-agents · 8 tokens");
	expect(expandedSkill).toContain("Write");
	expect(expandedSkill).toContain("Use short sentences.");
	expect(expandedSkill).not.toContain("# Write");
	const secondaryPointer = { ...pointer, button: 2 as const };
	expect(rendered.onMouse?.({ ...secondaryPointer, type: "press" })).toBe(true);
	expect(rendered.onMouse?.({ ...secondaryPointer, type: "release" })).toBe(true);
	const foldedSkill = Bun.stripANSI(rendered.render(80).join("\n"));
	expect(foldedSkill.split("\n")).toHaveLength(1);
	expect(rendered.onMouse?.({ ...secondaryPointer, type: "press" })).toBe(true);
	expect(rendered.onMouse?.({ ...secondaryPointer, type: "release" })).toBe(true);
	expect(Bun.stripANSI(rendered.render(80).join("\n"))).toContain("Use short sentences.");
	expect(sent).toMatchObject([
		{
			message: {
				customType: "pi-skills/loaded",
				content: `<skill>\n<name>writing-for-agents</name>\n<path>${filePath}</path>\n# Write\n\nUse short sentences.\n\n</skill>`,
				display: false,
				details: { version: 1, tool: "skill", status: "loaded", name: "writing-for-agents", filePath },
			},
			options: { deliverAs: "steer" },
		},
	]);
	expect(
		convertToLlm([
			{
				role: "custom",
				...sent[0]!.message,
				timestamp: 1,
			},
		] as never),
	).toEqual([
		{
			role: "user",
			content: [{ type: "text", text: sent[0]!.message.content }],
			timestamp: 1,
		},
	]);
});

test("restored pre-instructions skill details stay compact and do not crash", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-skills-"));
	const filePath = join(directory, "SKILL.md");
	writeFileSync(filePath, "# Write\n");
	const { tool } = skillTool(filePath);
	const historical = {
		content: [{ type: "text", text: 'Loaded skill "writing-for-agents".' }],
		details: {
			version: 1,
			tool: "skill",
			status: "loaded",
			name: "writing-for-agents",
			filePath,
			loadedChars: 8,
			supportingFiles: [],
		},
	} as never;
	const component = tool.renderResult!(
		historical,
		{ expanded: false, isPartial: false },
		{
			name: "skills-test",
			bold: (text: string) => text,
			getColorMode: () => "truecolor",
			getFgAnsi: () => "\x1b[39m",
			getBgAnsi: () => "\x1b[49m",
		} as never,
		{ invalidate() {}, isError: false } as never,
	);
	expect(Bun.stripANSI(component.render(80).join("\n")).split("\n")).toHaveLength(1);
});

test("missing skill details render a compact expandable failure", () => {
	const { tool } = skillTool("/missing/SKILL.md");
	const component = tool.renderResult!(
		{ content: [{ type: "text", text: 'Unknown skill "missing"' }], details: undefined as never },
		{ expanded: false, isPartial: false },
		{
			name: "skills-test",
			bold: (text: string) => text,
			getColorMode: () => "truecolor",
			getFgAnsi: () => "\x1b[39m",
			getBgAnsi: () => "\x1b[49m",
		} as never,
		{ args: { name: "missing" }, invalidate() {}, isError: true } as never,
	);
	expect(Bun.stripANSI(component.render(80).join("\n"))).toBe(`${icon("error")} Skill failed · missing ›`);
});

test("omits the directory when agents/openai.yaml is the only companion file", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-skills-"));
	const filePath = join(directory, "SKILL.md");
	mkdirSync(join(directory, "agents"));
	writeFileSync(filePath, "# Write\n");
	writeFileSync(join(directory, "agents", "openai.yaml"), "interface:\n  display_name: Write\n");

	const { tool, sent } = skillTool(filePath);
	const result = await tool.execute("call", { name: "writing-for-agents" }, undefined, undefined, {} as never);

	expect(result.content).toEqual([{ type: "text", text: 'Loaded skill "writing-for-agents".' }]);
	expect(sent[0]?.message.content).not.toContain("Skill directory:");
});

test("appends the absolute directory when the skill has supporting files", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-skills-"));
	const filePath = join(directory, "SKILL.md");
	writeFileSync(filePath, "---\nname: writing-for-agents\n---\n# Write\n");
	writeFileSync(join(directory, "SKILL-MECHANICS.md"), "# Mechanics\n");

	const { tool, sent } = skillTool(filePath);
	const result = await tool.execute("call", { name: "writing-for-agents" }, undefined, undefined, {} as never);

	expect(result.content).toEqual([{ type: "text", text: 'Loaded skill "writing-for-agents".' }]);
	expect(sent[0]?.message.content).toContain(`# Write\n\nSkill directory: ${directory}`);
	expect(result.details).toMatchObject({
		hasSupportingFiles: true,
		supportingFiles: ["SKILL-MECHANICS.md"],
		supportingFilesTruncated: false,
	});
});

test("reports an unknown exact skill name", async () => {
	const tool = createSkillTool({ getCommands: () => [], sendMessage: async () => {} } as never);

	expect(tool.execute("call", { name: "missing" }, undefined, undefined, {} as never)).rejects.toThrow(
		'Unknown skill "missing"',
	);
});

test("publishes visible skill names without filesystem locations", () => {
	const catalog = renderSkillsCatalog([
		{
			name: "writing-for-agents",
			description: "Write agent instructions.",
			filePath: "/private/skills/writing-for-agents/SKILL.md",
			disableModelInvocation: false,
		},
		{
			name: "hidden",
			description: "Hidden skill.",
			filePath: "/private/skills/hidden/SKILL.md",
			disableModelInvocation: true,
		},
	] as never);

	expect(catalog).toContain("writing-for-agents: Write agent instructions.");
	expect(catalog).not.toContain("/private/skills");
	expect(catalog).not.toContain("hidden");
});

test("adds the skill catalogue when skill is direct or available through exec", () => {
	getDeveloperMessageContributionRegistry().clear();
	const dispose = registerSkillsPromptContribution();
	try {
		const messages = renderDeveloperMessages({
			provider: "openai-codex",
			activeTools: ["skill"],
			sessionId: "session-1",
			systemPromptOptions: {
				cwd: "/repo",
				skills: [
					{
						name: "writing-for-agents",
						description: "Write agent instructions.",
						filePath: "/skills/writing-for-agents/SKILL.md",
						disableModelInvocation: false,
					},
				] as never,
			},
		});

		expect(messages).toEqual([
			{
				id: "pi-skills/catalog",
				content: expect.stringContaining("Call `tools.skill`"),
			},
		]);
		expect(
			renderDeveloperMessages({
				provider: "openai-codex",
				activeTools: ["codemode"],
				sessionId: "session-1",
				systemPromptOptions: {
					cwd: "/repo",
					skills: [{ name: "writing-for-agents", description: "Write agent instructions." }] as never,
				},
			}),
		).toHaveLength(1);
	} finally {
		dispose();
		getDeveloperMessageContributionRegistry().clear();
	}
});

test("does not add skill guidance when the skill tool is inactive", () => {
	getDeveloperMessageContributionRegistry().clear();
	const dispose = registerSkillsPromptContribution();
	try {
		const context = {
			provider: "openai-codex",
			sessionId: "session-1",
			systemPromptOptions: {
				cwd: "/repo",
				skills: [
					{
						name: "writing-for-agents",
						description: "Write agent instructions.",
						filePath: "/skills/writing-for-agents/SKILL.md",
						disableModelInvocation: false,
					},
				] as never,
			},
		};

		expect(renderDeveloperMessages({ ...context, activeTools: [] })).toEqual([]);
		expect(renderDeveloperMessages({ ...context, activeTools: ["read"] })).toEqual([]);
	} finally {
		dispose();
		getDeveloperMessageContributionRegistry().clear();
	}
});

test("catalogue visibility supports always and off without changing skill discovery", () => {
	getDeveloperMessageContributionRegistry().clear();
	let catalogVisibility: "always" | "off" = "always";
	const dispose = registerSkillsPromptContribution(() => ({
		catalogVisibility,
	}));
	const context = {
		provider: "openai-codex",
		activeTools: [] as string[],
		sessionId: "session-1",
		systemPromptOptions: {
			cwd: "/repo",
			skills: [{ name: "writing-for-agents", description: "Write agent instructions." }] as never,
		},
	};
	try {
		expect(renderDeveloperMessages(context)).toHaveLength(1);
		catalogVisibility = "off";
		expect(renderDeveloperMessages(context)).toEqual([]);
	} finally {
		dispose();
		getDeveloperMessageContributionRegistry().clear();
	}
});

test("hidden loaded-skill display still sends identical model context", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-skills-"));
	const filePath = join(directory, "SKILL.md");
	writeFileSync(filePath, "# Write\n");
	const sent: SentSkillMessage[] = [];
	const tool = createSkillTool({
		getCommands: () => [
			{
				name: "skill:writing-for-agents",
				description: "Writing documents for agents.",
				source: "skill",
				sourceInfo: { path: filePath },
			},
		],
		sendMessage: async (message: SentSkillMessage) => {
			sent.push(message);
		},
	} as never);

	await tool.execute("call", { name: "writing-for-agents" }, undefined, undefined, {} as never);
	expect(sent[0].display).toBe(false);
	expect(convertToLlm([{ role: "custom", ...sent[0], timestamp: 1 }] as never)).toEqual([
		{
			role: "user",
			content: [{ type: "text", text: sent[0].content }],
			timestamp: 1,
		},
	]);
});
