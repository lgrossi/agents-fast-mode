import { afterEach, beforeEach, expect, test } from "bun:test";
import { mock } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { configureTuiAppearance, DEFAULT_TUI_APPEARANCE, whenSyntaxReady } from "@luan.sh/pi-libtui";
import type { TuiMouseEvent } from "@luan.sh/pi-libtui/mouse";
import type { ExecProcessSnapshot, PtyDataEvent, UnifiedExecResult } from "../src/session-manager.ts";
import { type ProcessHubManager, ProcessTerminalStore } from "../src/ui/process-store.ts";
import { ProcessWidget } from "../src/ui/process-widget.ts";

const theme = {
	name: "process-widget-test",
	bold: (text: string) => text,
	getColorMode: () => "truecolor",
	getFgAnsi: () => "\x1b[38;2;120;160;220m",
	getBgAnsi: () => "\x1b[48;2;20;24;30m",
} as never as Theme;

beforeEach(() => mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10_000 }));
afterEach(() => {
	mock.timers.reset();
	configureTuiAppearance(DEFAULT_TUI_APPEARANCE);
});

test("renders animated syntax-highlighted process rows and opens the clicked process", async () => {
	configureTuiAppearance({
		...DEFAULT_TUI_APPEARANCE,
		iconPack: "nerd-fonts",
		activityIndicator: "static",
		textEffect: "off",
		pulseEffect: "off",
	});
	await new Promise<void>((resolve) => whenSyntaxReady(resolve));
	const fixture = setup([snapshot()]);
	const { widget, store, opened } = fixture;
	const status = fixture.status;
	const factory = fixture.factory;

	expect(status).toBe("1 running process");
	const component = factory?.({ terminal: { rows: 24 }, requestRender() {} } as never, theme);
	const rows = component?.render(100) ?? [];
	const rendered = Bun.stripANSI(rows.join("\n"));
	expect(rendered).toContain(" Processes · 1 running");
	expect(rendered).toContain("Processes · 1 running");
	expect(rendered).toContain("● #3");
	expect(rendered).toContain("#3");
	expect(rendered).toContain('for i in 1 2; do echo "$i"; done');
	expect(rendered).toContain("working");
	expect(new Set(rows[1]?.match(/\x1b\[38;[^m]*m/gu) ?? []).size).toBeGreaterThan(2);
	component?.onMouse(mouse("press", 1, 10, 0));
	component?.onMouse(mouse("release", 1, 10, 0));
	expect(opened).toEqual([3]);

	fixture.publish([
		{
			...snapshot(),
			command: `echo \x1b]52;c;secret\x07${"🙂\u0301".repeat(50_000)}`,
			output: `${"x".repeat(100_000)}\n`,
		},
	]);
	const boundedRows = component?.render(40) ?? [];
	expect(boundedRows.every((row) => visibleWidth(row) <= 40)).toBeTrue();
	expect(Bun.stripANSI(boundedRows[1] ?? "")).toContain("...");
	expect(boundedRows.join("\n")).not.toContain("\x1b]52");
	expect(boundedRows.join("\n")).not.toContain("secret");

	fixture.publish([{ ...snapshot(), state: "exited", exitCode: 0, finishedAtMs: Date.now() }]);
	expect(fixture.status).toBeUndefined();
	expect(fixture.factory).toBeDefined();
	expect(Bun.stripANSI(component?.render(100).join("\n") ?? "")).toContain("exited 0");
	mock.timers.tick(3_000);
	expect(fixture.factory).toBeUndefined();

	widget.dispose();
	store.dispose();
	expect(fixture.subscribed()).toBeFalse();
});

test("short processes never mount and silent processes appear only after three seconds", () => {
	const short = { ...snapshot(), startedAtMs: Date.now() };
	const fixture = setup([short]);
	expect(fixture.factory).toBeUndefined();
	mock.timers.tick(2_000);
	fixture.publish([{ ...short, state: "exited", exitCode: 0, finishedAtMs: Date.now() }]);
	mock.timers.tick(5_000);
	expect(fixture.factory).toBeUndefined();
	expect(fixture.status).toBeUndefined();

	const silent = { ...snapshot(), id: 4, startedAtMs: Date.now() };
	fixture.publish([silent]);
	mock.timers.tick(3_000);
	expect(fixture.factory).toBeUndefined();
	mock.timers.tick(1);
	expect(fixture.factory).toBeDefined();
	expect(fixture.status).toBe("1 running process");
	fixture.dispose();
});

test("completed rows hold for three seconds without admitting new short processes", () => {
	const process = snapshot();
	const fixture = setup([process]);
	const factory = fixture.factory;
	mock.timers.tick(500);
	fixture.publish([{ ...process, state: "exited", exitCode: 1, finishedAtMs: Date.now() }]);
	const short = { ...snapshot(), id: 4, startedAtMs: Date.now() };
	fixture.publish([short, { ...process, state: "exited", exitCode: 1, finishedAtMs: Date.now() }]);
	expect(fixture.factory).toBe(factory);
	expect(fixture.status).toBeUndefined();
	mock.timers.tick(2_499);
	expect(fixture.factory).toBe(factory);
	mock.timers.tick(1);
	expect(fixture.factory).toBeUndefined();
	mock.timers.tick(501);
	expect(fixture.factory).toBeDefined();
	expect(fixture.status).toBe("1 running process");
	fixture.dispose();
});

test("updates do not restart the delay and long-visible processes clear immediately on exit", () => {
	const process = { ...snapshot(), startedAtMs: Date.now() };
	const fixture = setup([process]);
	mock.timers.tick(2_000);
	fixture.publish([{ ...process, output: "more output" }]);
	mock.timers.tick(1_001);
	expect(fixture.factory).toBeDefined();
	mock.timers.tick(3_000);
	fixture.publish([{ ...process, state: "exited", exitCode: 0, finishedAtMs: Date.now() }]);
	expect(fixture.factory).toBeUndefined();
	fixture.dispose();
});

test.each([0, 4_000])("disposing cancels pending visibility changes after %i ms", (elapsed) => {
	const fixture = setup([{ ...snapshot(), startedAtMs: Date.now() - elapsed }]);
	fixture.dispose();
	mock.timers.tick(10_000);
	expect(fixture.factory).toBeUndefined();
	expect(fixture.status).toBeUndefined();
});

function setup(initial: readonly ExecProcessSnapshot[]) {
	let snapshots = initial;
	let processListener: ((value: readonly ExecProcessSnapshot[]) => void) | undefined;
	let ptyListener: ((event: PtyDataEvent) => void) | undefined;
	const manager = {
		exec: async () => result(),
		write: async () => result(),
		getSessionCommand: () => undefined,
		listProcesses: () => snapshots,
		subscribeProcesses(listener) {
			processListener = listener;
			listener(snapshots);
			return () => {
				processListener = undefined;
			};
		},
		onPtyData(listener) {
			ptyListener = listener;
			return () => {
				ptyListener = undefined;
			};
		},
		async interrupt() {
			return true;
		},
		async terminate() {
			return true;
		},
		async resize() {
			return true;
		},
		async sendInput() {
			return true;
		},
		async shutdown() {},
	} satisfies ProcessHubManager;
	const store = new ProcessTerminalStore(manager);
	const opened: number[] = [];
	const widget = new ProcessWidget(store, (processId) => opened.push(processId));
	let status: string | undefined;
	let factory:
		| ((tui: never, theme: Theme) => { render(width: number): string[]; onMouse(event: TuiMouseEvent): boolean })
		| undefined;
	const ui = {
		setStatus(_id: string, value: string | undefined) {
			status = value;
		},
		setWidget(_id: string, value: typeof factory) {
			factory = value;
		},
	} as never;
	widget.setUICtx(ui);

	return {
		widget,
		store,
		opened,
		get status() {
			return status;
		},
		get factory() {
			return factory;
		},
		publish(next: readonly ExecProcessSnapshot[]) {
			snapshots = next;
			processListener?.(snapshots);
		},
		subscribed: () => processListener !== undefined || ptyListener !== undefined,
		dispose() {
			widget.dispose();
			store.dispose();
		},
	};
}

function snapshot(): ExecProcessSnapshot {
	return {
		id: 3,
		command: 'for i in 1 2; do echo "$i"; done',
		cwd: "/tmp",
		shell: "/bin/zsh",
		tty: false,
		stdinOpen: false,
		state: "running",
		startedAtMs: Date.now() - 4_000,
		output: "working\n",
		outputTruncated: false,
	};
}

function mouse(type: TuiMouseEvent["type"], row: number, col: number, button?: 0 | 1 | 2): TuiMouseEvent {
	return {
		type,
		row,
		col,
		screenRow: row,
		screenCol: col,
		button,
		wheel: undefined,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

function result(): UnifiedExecResult {
	return { chunk_id: "chunk", wall_time_seconds: 0, output: "", output_truncated: false };
}
