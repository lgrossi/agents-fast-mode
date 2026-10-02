import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createCodemodeExtension,
	createReadToolDefinition,
	createToolSearchExtension,
	DefaultResourceLoader,
	initTheme,
	SettingsManager,
	type ToolDefinition,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { ProcessTerminal, stripTerminalSequences, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { installNativeToolBridge } from "../src/host/native-tool-bridge.ts";

const disposers: Array<() => void> = [];
const tui = new TuiAltScreen(new ProcessTerminal());
let root: string;
let definitions: Map<string, ToolDefinition>;
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-native-tool-framing-"));
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager: SettingsManager.inMemory(),
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
		noPromptTemplates: true,
		extensionFactories: [createCodemodeExtension(), createToolSearchExtension()],
	});
	await loader.reload();
	expect(loader.getExtensions().errors).toEqual([]);
	definitions = new Map(
		loader
			.getExtensions()
			.extensions.flatMap((extension) => [...extension.tools].map(([name, tool]) => [name, tool.definition])),
	);
});
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});
beforeEach(() => initTheme("dark", false));
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

function codemode(code = "text(ALL_TOOLS.map(({ name }) => name));") {
	return new ToolExecutionComponent("codemode", "script", { code }, {}, definitions.get("codemode"), tui, "/tmp");
}

test.each([40, 80, 160])("native codemode keeps bounded, unpainted previews at %i columns", (width) => {
	disposers.push(installNativeToolBridge());
	const component = codemode();
	component.updateResult({
		content: [
			{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
			{ type: "text", text: JSON.stringify(Array.from({ length: 300 }, (_, i) => `tool_${i}`)) },
		],
		details: { calls: [{ id: "script/1", name: "exec_command", args: '{"cmd":"pwd"}', status: "ok", durationMs: 10 }] },
		isError: false,
	});
	const lines = component.render(width);
	const text = lines.map(stripTerminalSequences).join("\n");
	expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
	expect(lines.join("\n")).not.toMatch(/\x1b\[(?:48|4[0-7]);?[^m]*m/);
	expect(text).toContain("exec_command");
	expect(text).toContain("pwd");
	expect(text).toContain("more lines");
	expect(text).not.toContain("Script completed");
	expect(lines.length).toBeLessThanOrEqual(12);
	component.setExpanded(true);
	expect(component.render(width).length).toBeGreaterThan(lines.length);
});

test("native tool search keeps its result and click-to-expand at the compact row coordinates", () => {
	const component = new ToolExecutionComponent(
		"tool_search",
		"search",
		{ query: "filesystem shell" },
		{},
		definitions.get("tool_search"),
		tui,
		"/tmp",
	);
	component.updateResult({
		content: [{ type: "text", text: Array.from({ length: 15 }, (_, i) => `result ${i}`).join("\n") }],
		isError: false,
	});
	const native = component.render(80);
	disposers.push(installNativeToolBridge());
	const compact = component.render(80);
	expect(compact.length).toBe(native.length - 2);
	expect(compact.map(stripTerminalSequences).join("\n")).toContain("result 0");
	expect(
		component.handleMouse({
			type: "click",
			button: "left",
			x: 0,
			y: 2,
			screenX: 0,
			screenY: 2,
			shift: false,
			alt: false,
			ctrl: false,
			width: 80,
			height: compact.length,
		})?.handled,
	).toBe(true);
	expect(component.render(80).map(stripTerminalSequences).join("\n")).toContain("result 14");
});

test("independent host leases restore native framing", () => {
	const component = codemode("text('done');");
	component.updateResult({
		content: [{ type: "text", text: "done" }],
		details: { calls: [] },
		isError: false,
	});
	const native = component.render(80);
	const first = installNativeToolBridge();
	const second = installNativeToolBridge();
	disposers.push(first, second);
	const compact = component.render(80);
	expect(compact.length).toBeLessThan(native.length);
	first();
	first();
	expect(component.render(80)).toEqual(compact);
	second();
	expect(component.render(80)).toEqual(native);
});

test.each(["codemode", "tool_search"])("%s errors keep Pi's visible failure feedback", (name) => {
	const component = new ToolExecutionComponent(name, "failed", {}, {}, definitions.get(name), tui, "/tmp");
	component.updateResult({ content: [{ type: "text", text: "Execution failed" }], isError: true });
	const native = component.render(80);
	disposers.push(installNativeToolBridge());
	expect(component.render(80)).toEqual(native);
	expect(native.map(stripTerminalSequences).join("\n")).toContain("Execution failed");
});

test("ordinary feature tool framing stays owned by its renderer", () => {
	const definition = createReadToolDefinition("/tmp");
	const component = new ToolExecutionComponent("read", "read", { path: "file.ts" }, {}, definition, tui, "/tmp");
	const native = component.render(80);
	disposers.push(installNativeToolBridge());
	expect(component.render(80)).toEqual(native);
});
