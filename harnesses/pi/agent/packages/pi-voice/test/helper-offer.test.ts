import { expect, test } from "bun:test";
import { startRealtimeOffer } from "../src/conversation/helper-offer.ts";
import type { VoiceHelperCommand, VoiceHelperEvent } from "../src/helper.ts";
import { getVoiceConfig } from "../src/settings.ts";

test.each([5, 6])(
	"conversation offer accepts compatible helper protocol %i for native and phone peers",
	async (version) => {
		for (const mode of ["native", "bridge"] as const) {
			let listener: ((event: VoiceHelperEvent) => void) | undefined;
			const sent: VoiceHelperCommand[] = [];
			const helper = {
				protocolVersion: version,
				async start() {},
				async close() {},
				onEvent(callback: (event: VoiceHelperEvent) => void) {
					listener = callback;
					return () => {
						listener = undefined;
					};
				},
				onExit() {
					return () => {};
				},
				send(command: VoiceHelperCommand) {
					sent.push(command);
					listener?.({ type: "offer", sdp: "offer" });
				},
			};
			expect(await startRealtimeOffer(helper, getVoiceConfig(), mode)).toBe("offer");
			expect(sent[0]?.type).toBe(mode === "native" ? "start_v3" : "start_v3_bridge");
			expect(listener).toBeUndefined();
		}
	},
);

test("conversation refuses an older incompatible helper before opening the microphone", async () => {
	let closed = false;
	const helper = {
		protocolVersion: 4,
		async start() {},
		async close() {
			closed = true;
		},
		onEvent() {
			return () => {};
		},
		onExit() {
			return () => {};
		},
		send() {
			throw new Error("must not start capture");
		},
	};
	await expect(startRealtimeOffer(helper, getVoiceConfig(), "native")).rejects.toThrow("expected 5 or 6");
	expect(closed).toBe(true);
});
