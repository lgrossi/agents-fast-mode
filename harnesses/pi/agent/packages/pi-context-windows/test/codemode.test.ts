import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createCodemodeExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { readNotes } from "../src/core/state.ts";
import contextExtension from "../src/extension.ts";

test("built-in codemode preserves note results and enforces nested tool policy", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-context-codemode-"));
	const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const scripts = [
		`await tools.notes__write_file({ path: "checkpoint", text: "keep me" });
const note = await tools.notes__read_file({ path: "checkpoint" });
if (note.text !== "keep me") throw new Error("Missing structured note result");
let blocked = false;
try { await tools.notes__write_file({ path: "checkpoint", text: "blocked" }); }
catch (error) { blocked = error.message.includes("Fixture policy"); }
if (!blocked) throw new Error("Nested policy was bypassed");
store("checked", note.text);`,
		`if (load("checked") !== "keep me") throw new Error("Missing stored value");
text("CODEMODE_OK");`,
	];
	let step = 0;
	const guarded: string[] = [];
	const nested: string[] = [];
	const manager = SessionManager.inMemory(root);
	const runtime = await ModelRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(root, "models.json"),
		refreshOnCreate: false,
	});
	runtime.registerProvider("codemode-test", {
		baseUrl: "https://test.invalid",
		apiKey: "fixture",
		api: "openai-responses",
		models: [
			{
				id: "fixture",
				name: "Fixture",
				reasoning: false,
				input: ["text"],
				cost,
				contextWindow: 10000,
				maxTokens: 1000,
			},
		],
		streamSimple(model) {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const code = scripts[step++];
				const stopReason = code === undefined ? "stop" : "toolUse";
				const message: AssistantMessage = {
					role: "assistant",
					api: model.api,
					provider: model.provider,
					model: model.id,
					content:
						code === undefined
							? [{ type: "text", text: "Done" }]
							: [{ type: "toolCall", id: `code-${step}`, name: "codemode", arguments: { code } }],
					stopReason,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...cost, total: 0 } },
					timestamp: 0,
				};
				stream.push({ type: "done", reason: stopReason, message });
				stream.end();
			});
			return stream;
		},
	});
	const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager: settings,
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
		noPromptTemplates: true,
		extensionFactories: [
			createCodemodeExtension(),
			contextExtension,
			(pi) => {
				pi.on("tool_call", (event) => {
					if (event.toolName === "notes__write_file") {
						guarded.push(event.toolName);
						if (event.input.text === "blocked") return { block: true, reason: "Fixture policy" };
					}
					return undefined;
				});
			},
		],
	});
	try {
		await loader.reload();
		expect(loader.getExtensions().errors).toEqual([]);
		const { session } = await createAgentSession({
			cwd: root,
			agentDir: root,
			modelRuntime: runtime,
			model: runtime.getModel("codemode-test", "fixture"),
			settingsManager: settings,
			sessionManager: manager,
			resourceLoader: loader,
			tools: ["codemode", "notes__write_file", "notes__read_file", "new_context"],
		});
		try {
			session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.parentToolCallId) nested.push(event.toolName);
			});
			expect(session.getCallableToolNames()).not.toContain("new_context");
			await session.prompt("Validate notes and policy.");
			const results = session.messages.filter((message) => message.role === "toolResult");
			expect(results.every((result) => !result.isError)).toBe(true);
			expect(JSON.stringify(results)).toContain("CODEMODE_OK");
			expect(readNotes(manager.getBranch()).get("checkpoint")?.text).toBe("keep me");
			expect(guarded).toEqual(["notes__write_file", "notes__write_file"]);
			expect(nested).toEqual(["notes__write_file", "notes__read_file", "notes__write_file"]);
		} finally {
			await session.dispose();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
