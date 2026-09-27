import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEventBus,
	createExtensionRuntime,
	ExtensionRunner,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	type TerminalInputHandler,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { loadExtensionFromFactory } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { ensureActionsRegistry } from "@luan.sh/pi-libactions/sdk";
import { VoiceController } from "../src/controller.ts";
import type { CodexDictationCallbacks } from "../src/dictation/session.ts";
import { getVoiceConfig } from "../src/settings.ts";
import { voiceControls } from "../src/ui.ts";

async function contextFixture() {
	const directory = await mkdtemp(join(tmpdir(), "pi-voice-controls-"));
	const models = await ModelRuntime.create({
		authPath: join(directory, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(directory, "models.json"),
		refreshOnCreate: false,
	});
	const registry = new ModelRegistry(models);
	const [provider, id] = getVoiceConfig().voice.contextModel.split("/");
	const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } })).toString("base64url")}.fixture`;
	registry.registerProvider(provider!, {
		api: "openai-responses",
		apiKey: token,
		baseUrl: "https://chatgpt.com/backend-api/codex",
		models: [
			{
				id: id!,
				name: "Fixture",
				input: ["text"],
				reasoning: false,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 1000,
			},
		],
	});
	const runtime = createExtensionRuntime();
	const runner = new ExtensionRunner([], runtime, directory, SessionManager.inMemory(directory), registry);
	let draft = "Existing draft";
	const notices: string[] = [];
	const statuses = new Map<string, string | undefined>();
	type WidgetContent = Parameters<ExtensionUIContext["setWidget"]>[1] | string[];
	const widgets = new Map<string, WidgetContent>();
	const inputs = new Set<TerminalInputHandler>();
	const ui = {
		...runner.getUIContext(),
		notify: (message: string) => {
			notices.push(message);
		},
		setStatus: (key: string, value: string | undefined) => {
			statuses.set(key, value);
		},
		setWidget: (key: string, value: WidgetContent) => {
			widgets.set(key, value);
		},
		getEditorText: () => draft,
		setEditorText: (value: string) => {
			draft = value;
		},
		onTerminalInput: (handler: TerminalInputHandler) => {
			inputs.add(handler);
			return () => {
				inputs.delete(handler);
			};
		},
	};
	runner.setUIContext(ui, "tui");
	return {
		directory,
		runtime,
		runner,
		registry,
		ui,
		notices,
		statuses,
		widgets,
		inputs,
		ctx: runner.createContext(),
		cleanup: () => rm(directory, { recursive: true, force: true }),
	};
}

function dictationFixture() {
	const sessions: Array<{
		callbacks: CodexDictationCallbacks;
		finish: ReturnType<typeof Promise.withResolvers<void>>;
		close: ReturnType<typeof Promise.withResolvers<void>>;
	}> = [];
	const controller = new VoiceController({ appendEntry() {}, sendMessage() {} }, (callbacks) => {
		const session = { callbacks, finish: Promise.withResolvers<void>(), close: Promise.withResolvers<void>() };
		sessions.push(session);
		return {
			async start() {
				callbacks.onStatus("recording");
			},
			async finish() {
				callbacks.onStatus("transcribing");
				await session.finish.promise;
				callbacks.onTranscript("Spoken draft");
			},
			close: () => session.close.promise,
		};
	});
	return { controller, sessions };
}

test("voice toggle cancels startup without reporting an abort or disturbing the next mode", async () => {
	const f = await contextFixture();
	const { controller, sessions } = dictationFixture();
	try {
		const starting = controller.toggle(f.ctx);
		expect(controller.status).toBe("preparing context");
		await controller.toggle(f.ctx);
		await starting;
		expect(controller.status).toBe("off");
		expect(controller.active).toBe(false);
		await controller.toggleDictation(f.ctx);
		expect(controller.recording).toBe(true);
		await expect(controller.toggle(f.ctx)).rejects.toThrow("Finish or cancel dictation");
		sessions[0]!.close.resolve();
		await controller.stop();
		expect(f.notices).toEqual([]);
	} finally {
		await f.cleanup();
	}
});

test("dictation finish appends once; cancel during transcription preserves the draft and next recording", async () => {
	const f = await contextFixture();
	const { controller, sessions } = dictationFixture();
	try {
		await controller.toggleDictation(f.ctx);
		const finish = controller.toggleDictation(f.ctx);
		expect(controller.status).toBe("transcribing");
		sessions[0]!.finish.resolve();
		await finish;
		expect(f.ui.getEditorText()).toBe("Existing draft\nSpoken draft");
		expect(controller.status).toBe("off");

		await controller.toggleDictation(f.ctx);
		const cancelledFinish = controller.toggleDictation(f.ctx);
		const cancel = controller.stop();
		expect(controller.stop()).toBe(cancel);
		expect(controller.recording).toBe(false);
		await expect(controller.toggleDictation(f.ctx)).rejects.toThrow("Stop conversation");
		sessions[1]!.close.resolve();
		await cancel;
		await controller.toggleDictation(f.ctx);
		sessions[1]!.finish.resolve();
		await cancelledFinish;
		sessions[1]!.callbacks.onStatus("late status");
		sessions[1]!.callbacks.onError(new Error("late failure"));
		expect(f.ui.getEditorText()).toBe("Existing draft\nSpoken draft");
		expect(controller.recording).toBe(true);
		expect(controller.status).toBe("recording");
		expect(f.notices).toEqual([]);
		sessions[2]!.close.resolve();
		await controller.stop();
	} finally {
		await f.cleanup();
	}
});

test("dictation cancelled during authentication ignores a late auth failure", async () => {
	const f = await contextFixture();
	const { controller, sessions } = dictationFixture();
	const auth = Promise.withResolvers<Awaited<ReturnType<ModelRegistry["getProviderAuth"]>>>();
	const spy = spyOn(f.registry, "getProviderAuth").mockImplementationOnce(() => auth.promise);
	try {
		const start = controller.toggleDictation(f.ctx);
		expect(controller.status).toBe("connecting");
		sessions[0]!.close.resolve();
		await controller.stop();
		await controller.toggleDictation(f.ctx);
		auth.reject(new Error("late auth error"));
		await start;
		expect(controller.status).toBe("recording");
		expect(f.ui.getEditorText()).toBe("Existing draft");
		expect(f.notices).toEqual([]);
		sessions[1]!.close.resolve();
		await controller.stop();
	} finally {
		spy.mockRestore();
		await f.cleanup();
	}
});

test("registered dictation action and contextual Escape cancel without taking idle Escape", async () => {
	const f = await contextFixture();
	const { controller, sessions } = dictationFixture();
	let dispose = () => {};
	let phoneOpened = 0;
	try {
		const extension = await loadExtensionFromFactory(
			(pi) => {
				dispose = voiceControls(pi, controller, async () => {
					phoneOpened++;
				});
			},
			f.directory,
			createEventBus(),
			f.runtime,
		);
		const runner = new ExtensionRunner(
			[extension],
			f.runtime,
			f.directory,
			SessionManager.inMemory(f.directory),
			f.registry,
		);
		runner.setUIContext(f.ui, "tui");
		await runner.emit({ type: "session_start", reason: "startup" });
		const input = (data: string) => [...f.inputs].map((handler) => handler(data));
		expect(input("\x1b")).toEqual([undefined]);
		const action = ensureActionsRegistry().find("voice.dictate")!;
		await action.run(runner.createContext());
		expect(typeof f.widgets.get("pi-voice")).toBe("function");
		expect(f.statuses.has("pi-voice")).toBe(false);
		expect(input("ordinary typing")).toEqual([undefined]);
		sessions[0]!.close.resolve();
		expect(input("\x1b[27u")).toEqual([{ consume: true }]);
		await controller.stop();
		expect(f.ui.getEditorText()).toBe("Existing draft");
		expect(input("\x1b")).toEqual([undefined]);
		await runner.getCommand("voice:connect")!.handler("", runner.createCommandContext());
		expect(phoneOpened).toBe(1);
		expect(controller.status).toBe("off");
		await runner.emit({ type: "session_start", reason: "startup" });
		expect(f.inputs.size).toBe(1);
		dispose();
		expect(f.inputs.size).toBe(0);
		expect(ensureActionsRegistry().find("voice.dictate")).toBeUndefined();
		expect(f.statuses.get("pi-voice")).toBeUndefined();
		expect(f.widgets.get("pi-voice")).toBeUndefined();
	} finally {
		dispose();
		await f.cleanup();
	}
});

test("finishing dictation during microphone startup closes it before recording", async () => {
	const { CodexDictationSession } = await import("../src/dictation/session.ts");
	const { VoiceHelperClient } = await import("../src/helper.ts");
	const ready = Promise.withResolvers<void>();
	const helper = spyOn(VoiceHelperClient.prototype, "start").mockImplementationOnce(() => ready.promise);
	const transcripts: string[] = [];
	const errors: Error[] = [];
	const session = new CodexDictationSession({
		onError: (error) => errors.push(error),
		onStatus() {},
		onTranscript: (text) => transcripts.push(text),
	});
	try {
		const start = session.start(
			{ headers: new Headers(), baseUrl: "https://test.invalid", officialCodex: false },
			getVoiceConfig(),
		);
		await session.finish();
		ready.resolve();
		await start;
		expect(transcripts).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		helper.mockRestore();
		await session.close();
	}
});
