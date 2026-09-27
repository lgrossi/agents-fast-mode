import { expect, test } from "bun:test";
import { CodexRealtimeConversation, type CodexConversationCallbacks } from "../src/conversation/session.ts";
import type { CodexRealtimePeer, CodexRealtimePeerEvent } from "../src/conversation/peer.ts";
import type { JsonValue } from "../src/wire-value.ts";
import { getVoiceConfig } from "../src/settings.ts";
import { VoiceActivity } from "../src/activity.ts";
import { renderVoiceStrip } from "../src/voice-strip.ts";
import { tuiTheme } from "@luan.sh/pi-libtui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

class Peer implements CodexRealtimePeer {
	readonly kind = "webrtc";
	listener?: (event: CodexRealtimePeerEvent) => void;
	closed = false;
	muted = false;
	sent: JsonValue[] = [];
	onEvent(listener: (event: CodexRealtimePeerEvent) => void) {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}
	onExit() {
		return () => {};
	}
	async start() {
		return "offer";
	}
	applyAnswer() {
		this.listener?.({ type: "state", state: "ready" });
	}
	sendData(message: JsonValue) {
		this.sent.push(message);
	}
	setInputMuted(value: boolean) {
		this.muted = value;
	}
	async close() {
		this.closed = true;
	}
}
const auth = { headers: new Headers(), baseUrl: "https://test.invalid", officialCodex: true };
function callbacks(): CodexConversationCallbacks {
	return {
		onError: () => {},
		onDrop: () => {},
		onStatus: () => {},
		onTurn: () => {},
		onUserTranscript: () => {},
		onTranscriptTail: () => {},
	};
}

test("voice startup sends readable context and preserves mute before the peer becomes ready", async () => {
	const peer = new Peer();
	let request = "";
	const call = new CodexRealtimeConversation(callbacks(), peer, async (_endpoint, _headers, _signal, body) => {
		request = body;
		return { status: 201, answer: "answer" };
	});
	try {
		await call.start(
			auth,
			getVoiceConfig(),
			"Voice instructions",
			[{ type: "message", role: "developer", content: [{ type: "input_text", text: "Current task" }] }],
			true,
		);
		call.markEstablished();
		expect(JSON.parse(request).session.initial_items[0].content[0].text).toBe("Current task");
		expect(peer.muted).toBe(true);
		expect(call.microphoneMuted).toBe(true);
		call.setInputMuted(false);
		expect(peer.muted).toBe(false);
	} finally {
		await call.close();
	}
	expect(peer.closed).toBe(true);
});

test("closing a call cancels an in-flight setup request without opening another peer", async () => {
	const peer = new Peer();
	const entered = Promise.withResolvers<void>();
	const call = new CodexRealtimeConversation(callbacks(), peer, async (_endpoint, _headers, signal) => {
		entered.resolve();
		return new Promise((_, reject) =>
			signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
		);
	});
	const started = call.start(auth, getVoiceConfig(), "Instructions").catch((error: Error) => error);
	await entered.promise;
	await call.close();
	expect(await started).toMatchObject({ message: "aborted" });
	expect(peer.closed).toBe(true);
});

test("live captions and levels accompany persisted turns and stop when the call closes", async () => {
	const peer = new Peer();
	const captions: Array<[string, string, boolean]> = [];
	const levels: number[] = [];
	const turns: string[] = [];
	const call = new CodexRealtimeConversation(
		{
			...callbacks(),
			onLevels: (value) => levels.push(value.microphone),
			onCaption: (...caption) => captions.push(caption),
			onUserTranscript: (text) => turns.push(text),
		},
		peer,
		async () => ({ status: 201, answer: "answer" }),
	);
	await call.start(auth, getVoiceConfig(), "Instructions");
	const emit = peer.listener!;
	emit({ type: "levels", microphone: 123, speaker: 4 });
	emit({ type: "data", message: { type: "input_transcript.added", item: { text: "Hello" } } });
	emit({ type: "data", message: { type: "turn.done", turn: { role: "user", transcript: "Hello" } } });
	emit({ type: "data", message: { type: "output_transcript.added", item: { text: "Hi" } } });
	emit({ type: "data", message: { type: "turn.done", turn: { role: "assistant", transcript: "Hi" } } });
	expect(captions).toEqual([
		["user", "Hello", false],
		["user", "", true],
		["assistant", "Hi", false],
		["assistant", "", true],
	]);
	expect(turns).toEqual(["Hello"]);
	await call.close();
	emit({ type: "levels", microphone: 255, speaker: 255 });
	emit({ type: "data", message: { type: "input_transcript.added", item: { text: "late" } } });
	expect(levels).toEqual([123]);
	expect(captions).toHaveLength(4);
});

test.each(["user", "assistant"] as const)(
	"%s transcript fragments retain spacing in captions and the saved tail",
	async (role) => {
		const peer = new Peer();
		const activity = new VoiceActivity();
		const tails: string[] = [];
		const call = new CodexRealtimeConversation(
			{
				...callbacks(),
				onCaption: (speaker, delta, final) => activity.caption(speaker, delta, final),
				onTranscriptTail: (text) => tails.push(text),
			},
			peer,
			async () => ({ status: 201, answer: "answer" }),
		);
		const fragments = [
			"Alright, ",
			"no",
			" ",
			"pres",
			"sure",
			".",
			" We",
			" can",
			" just ",
			"hang",
			" out",
			".  你好",
			"世界",
		];
		const text = fragments.join("");
		try {
			await call.start(auth, getVoiceConfig(), "Instructions");
			for (const fragment of fragments)
				peer.listener?.({
					type: "data",
					message: {
						type: role === "user" ? "input_transcript.added" : "output_transcript.added",
						item: { text: fragment },
					},
				});
			expect(activity.captions[role]).toBe(text);
			const lines = renderVoiceStrip(
				{ status: "speaking", active: true, recording: false, muted: false, activity },
				{ toggle: "alt+v", mute: "ctrl+x", dictate: "alt+shift+v" },
				tuiTheme(getThemeByName("dark")!),
				160,
			);
			expect(lines.map(stripTerminalSequences).join("\n")).toContain(`${role === "user" ? "You" : "Pi"}: ${text}`);
		} finally {
			await call.close();
		}
		expect(tails).toEqual([`${role}: ${text}`]);
	},
);
