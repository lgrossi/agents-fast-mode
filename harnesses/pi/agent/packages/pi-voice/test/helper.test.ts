import assert from "node:assert/strict";
import test from "node:test";
import { BoundedJsonlReader, parseVoiceHelperEvent } from "../src/helper.ts";

test("voice helper parser validates protocol payloads", () => {
	assert.deepEqual(parseVoiceHelperEvent({ type: "ready", version: 4 }), {
		type: "ready",
		version: 4,
	});
	assert.deepEqual(
		parseVoiceHelperEvent({
			type: "devices",
			inputs: [{ id: "input-1", name: "USB microphone", is_default: true }],
			outputs: [{ id: "output-1", name: "Headphones", is_default: false }],
		}),
		{
			type: "devices",
			inputs: [{ id: "input-1", name: "USB microphone", is_default: true }],
			outputs: [{ id: "output-1", name: "Headphones", is_default: false }],
		},
	);
	assert.deepEqual(
		parseVoiceHelperEvent({
			type: "pcm",
			audio: "AA==",
			sample_rate: 24_000,
			num_channels: 1,
		}),
		{
			type: "pcm",
			audio: "AA==",
			sample_rate: 24_000,
			num_channels: 1,
		},
	);
	assert.throws(() =>
		parseVoiceHelperEvent({
			type: "pcm",
			audio: "AA==",
			sample_rate: 48_000,
			num_channels: 2,
		}),
	);
	assert.throws(() =>
		parseVoiceHelperEvent({
			type: "data",
			message: { transcript: "x".repeat(64 * 1024) },
		}),
	);
	assert.throws(() => parseVoiceHelperEvent({ type: "surprise" }));
	assert.deepEqual(parseVoiceHelperEvent({ type: "levels", microphone: 0, speaker: 255 }), {
		type: "levels",
		microphone: 0,
		speaker: 255,
	});
	for (const level of [-1, 256, 0.5, Number.NaN, "1", undefined]) {
		assert.throws(() => parseVoiceHelperEvent({ type: "levels", microphone: level, speaker: 0 }));
		assert.throws(() => parseVoiceHelperEvent({ type: "levels", microphone: 0, speaker: level }));
	}
});

test("voice helper JSONL parser bounds unterminated frames", () => {
	const lines: string[] = [];
	let oversized = 0;
	const reader = new BoundedJsonlReader(
		8,
		(line) => lines.push(line),
		() => {
			oversized += 1;
		},
	);
	reader.push(Buffer.from("one\r\ntwo\n12345678"));
	assert.deepEqual(lines, ["one", "two"]);
	reader.push(Buffer.from("9"));
	assert.equal(oversized, 1);
	reader.push(Buffer.from("\nignored"));
	assert.deepEqual(lines, ["one", "two"]);
});
