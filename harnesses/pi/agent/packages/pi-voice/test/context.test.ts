import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { buildRealtimeInitialItems } from "../src/context.ts";
import { getVoiceConfig } from "../src/settings.ts";

test("voice continuity includes current notes and selected branch speech without encrypted checkpoints", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-voice-context-"));
	try {
		const runtime = await ModelRuntime.create({
			authPath: join(directory, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(directory, "models.json"),
			refreshOnCreate: false,
		});
		const registry = new ModelRegistry(runtime);
		let received = "";
		registry.registerProvider("voice-test", {
			api: "openai-responses",
			apiKey: "fixture",
			baseUrl: "https://test.invalid",
			models: [
				{
					id: "summary",
					name: "Summary",
					input: ["text"],
					reasoning: false,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 100000,
					maxTokens: 1000,
				},
			],
			streamSimple(model, context, options) {
				received = JSON.stringify(context);
				expect(options?.sessionId).toBeUndefined();
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "Continuity ready" }],
							api: model.api,
							provider: model.provider,
							model: model.id,
							stopReason: "stop",
							timestamp: 1,
							usage: {
								input: 1,
								output: 1,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 2,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
						},
					});
					stream.end();
				});
				return stream;
			},
		});
		const manager = SessionManager.inMemory(directory);
		manager.appendCustomEntry("pi-context/note", { version: 1, path: "goal", text: "OBSOLETE_NOTE" });
		manager.appendCustomEntry("pi-context/note", { version: 1, path: "goal", text: "CURRENT_NOTE" });
		const branch = manager.appendCustomEntry("pi-voice/transcript", { text: "SELECTED_SPEECH" });
		manager.appendCustomEntry("pi-context/note", { version: 1, path: "goal", text: "OTHER_BRANCH_NOTE" });
		manager.appendCustomEntry("pi-context/window", { version: 1, providerCheckpoint: "ENCRYPTED_SECRET" });
		const config = getVoiceConfig();
		config.voice.contextModel = "voice-test/summary";
		const result = await buildRealtimeInitialItems(
			{ sessionManager: manager, modelRegistry: registry },
			config,
			undefined,
			branch,
		);
		expect(received).toContain("CURRENT_NOTE");
		expect(received).toContain("SELECTED_SPEECH");
		for (const excluded of ["OBSOLETE_NOTE", "OTHER_BRANCH_NOTE", "ENCRYPTED_SECRET"])
			expect(received).not.toContain(excluded);
		expect(JSON.stringify(result)).toContain("Continuity ready");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
