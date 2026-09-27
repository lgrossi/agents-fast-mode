import { expect, test } from "bun:test";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { tuiTheme } from "@luan.sh/pi-libtui";
import { VoiceActivity } from "../src/activity.ts";
import { renderVoiceStrip, type VoiceStripState } from "../src/voice-strip.ts";

const theme = tuiTheme(getThemeByName("dark")!);
const keys = { toggle: "alt+v", dictate: "alt+shift+v", mute: "ctrl+x" };
function state() {
	return {
		status: "listening",
		active: true,
		recording: false,
		muted: false,
		activity: new VoiceActivity(),
	};
}
const plain = (s: VoiceStripState, width = 80) => renderVoiceStrip(s, keys, theme, width).map(stripTerminalSequences);

test("voice strip reflects measured audio, preserves samples across redraws, and clears only the muted mic", () => {
	const s = state();
	s.status = "connecting";
	expect(plain(s).join("\n")).toContain("voice ◌ connecting");
	expect(plain(s).join("\n")).not.toContain("mute");
	s.status = "listening";
	for (let i = 0; i < 8; i++) s.activity.levels({ microphone: i * 32, speaker: 255 });
	const first = plain(s);
	expect(first[0]).toContain("voice ● listening");
	expect(first[0]).toContain("ctrl+x mute  alt+v stop");
	expect(first[1]).toBe("mic ▃▄▅▅▆▇  Pi ██████");
	expect(plain(s)).toEqual(first);
	s.muted = true;
	s.activity.mute();
	expect(plain(s)[0]).toContain("voice ◌ muted");
	expect(plain(s)[0]).toContain("ctrl+x unmute");
	expect(plain(s)[1]).toBe("mic ▁▁▁▁▁▁  Pi ██████");
});

test("dictation exposes finish only while recording and cancel through transcription", () => {
	const s = state();
	s.active = false;
	s.recording = true;
	s.status = "recording";
	s.activity.levels({ microphone: 255, speaker: 0 });
	expect(plain(s).join("\n")).toContain("alt+shift+v finish  esc cancel");
	s.status = "transcribing";
	const processing = plain(s).join("\n");
	expect(processing).toContain("dictation ◌ transcribing");
	expect(processing).toContain("esc cancel");
	expect(processing).not.toContain("finish");
	expect(processing).not.toContain("mic");
	s.status = "off";
	expect(plain(s)).toEqual([]);
});

test("captions stay bounded, sanitize terminal controls, and fit narrow Unicode terminals", () => {
	const s = state();
	s.activity.caption("user", "界".repeat(2100), false);
	s.activity.caption("user", "\nlast words\x1b]52;c;secret\x07", false);
	s.activity.caption("assistant", "response", false);
	expect(Array.from(s.activity.captions.user)).toHaveLength(2048);
	for (const width of [1, 10, 20, 40, 80]) {
		for (const line of renderVoiceStrip(s, keys, theme, width)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(stripTerminalSequences(line)).not.toMatch(/[\n\r\x07]/u);
			expect(line).not.toContain("secret");
		}
	}
	expect(plain(s).join("\n")).toContain("last words");
	s.activity.caption("user", "", true);
	expect(plain(s).join("\n")).not.toContain("You:");
	expect(plain(s).join("\n")).toContain("Pi: response");
	s.activity.clear();
	expect(s.activity.captions).toEqual({ user: "", assistant: "" });
});
