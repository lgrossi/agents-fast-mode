import { afterEach, beforeEach, expect, test } from "bun:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { configureTuiAppearance, DEFAULT_TUI_APPEARANCE } from "../src/appearance.ts";
import { backgroundAnsiAtColumn } from "../src/decoration/powerline-pill.ts";
import { installUserMessageBridge } from "../src/host/user-message-bridge.ts";

const disposers: Array<() => void> = [];
beforeEach(() => initTheme("dark", false));
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	configureTuiAppearance(DEFAULT_TUI_APPEARANCE);
});

test("compact rounded bubbles toggle live without changing native messages", () => {
	const message = new UserMessageComponent("Hello **world** — 你好 👋");
	const native = message.render(100);
	const remove = installUserMessageBridge();
	disposers.push(remove);
	expect(message.render(100)).toEqual(native);
	configureTuiAppearance({ userMessageBubbles: true, iconPack: "nerd-fonts" });
	const lines = message.render(100);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain("");
	expect(lines[0]).toContain("");
	expect(lines[0]).toContain(`\x1b]133;A\x07${" ".repeat(40)}`);
	expect(visibleWidth(lines[0]!)).toBe(100);
	configureTuiAppearance({ userMessageBubbles: false });
	expect(message.render(100)).toEqual(native);
	configureTuiAppearance({ userMessageBubbles: true });
	remove();
	expect(message.render(100)).toEqual(native);
});

test.each([20, 39, 40, 81, 120])("wraps within 60 columns without vertical padding at %i", (width) => {
	const message = new UserMessageComponent("Wide 字 and words with **emphasis**. ".repeat(12));
	const bubbleWidth = Math.min(60, width < 40 ? width : Math.floor(width * 0.75));
	const expectedHeight = message.render(bubbleWidth - 2).length - 2;
	disposers.push(installUserMessageBridge());
	configureTuiAppearance({ userMessageBubbles: true, iconPack: "nerd-fonts" });
	const lines = message.render(width);
	expect(lines).toHaveLength(expectedHeight);
	expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
	expect(lines[0]).toContain("");
	expect(lines[0]).toContain("");
	expect(lines[1]).toContain("█");
	const gutter = width - bubbleWidth;
	const bodyBackground = backgroundAnsiAtColumn(lines[1]!, gutter + 2);
	expect(bodyBackground).not.toBe("\x1b[49m");
	for (const line of lines) {
		for (const column of [gutter + 1, gutter + 2, width - 2]) {
			expect(backgroundAnsiAtColumn(line, column)).toBe(bodyBackground);
		}
	}
	expect(lines.at(-1)).toContain("");
	expect(lines.at(-1)).toContain("");
	expect(lines.at(-1)).toContain("\x1b]133;B\x07\x1b]133;C\x07");
});

test("duplicate installs release independently", () => {
	const message = new UserMessageComponent("hello");
	const native = message.render(80);
	const first = installUserMessageBridge();
	const second = installUserMessageBridge();
	disposers.push(first, second);
	configureTuiAppearance({ userMessageBubbles: true, iconPack: "nerd-fonts" });
	expect(message.render(80)).toHaveLength(1);
	first();
	first();
	expect(message.render(80)).toHaveLength(1);
	second();
	expect(message.render(80)).toEqual(native);
});
