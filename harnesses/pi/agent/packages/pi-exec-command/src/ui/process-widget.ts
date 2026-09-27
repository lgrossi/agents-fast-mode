import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import {
	type ActivityAnimationOverrides,
	activityFrame,
	highlightSyntaxBlock,
	icon,
	type MotionMount,
	mountConfiguredAnimation,
	PointerInteractionController,
	sanitizeTuiField,
	sanitizeTuiFieldPreview,
	type TuiTheme,
	tuiTheme,
	whenSyntaxReady,
} from "@luan.sh/pi-libtui";
import type { TuiMouseEvent } from "@luan.sh/pi-libtui/mouse";
import type { ExecProcessSnapshot } from "../session-manager.ts";
import type { ProcessTerminalStore } from "./process-store.ts";

type HostTheme = Parameters<typeof tuiTheme>[0];
type UIContext = ExtensionContext["ui"];

const PROCESS_WIDGET_DELAY_MS = 3_000;
const PROCESS_WIDGET_MIN_VISIBLE_MS = 3_000;

interface ProcessTarget {
	readonly process: ExecProcessSnapshot;
	readonly row: number;
	readonly width: number;
}

interface ProcessPreview {
	readonly command: string;
	readonly shell: string;
	readonly output: string;
	readonly width: number;
	readonly commandSpans: ReturnType<typeof highlightSyntaxBlock>[number];
	readonly outputLine: string;
}

/** Compact indication for running processes whose transcript rows may be offscreen. */
export class ProcessWidget {
	private uiCtx: UIContext | undefined;
	private motion: MotionMount | undefined;
	private tui: TUI | undefined;
	private registered = false;
	private visibilityTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly visible = new Map<number, { process: ExecProcessSnapshot; shownAtMs: number }>();
	private lastStatus: string | undefined;
	private animation: Readonly<ActivityAnimationOverrides>;
	private syntaxReadyRequested = false;
	private readonly unsubscribe: () => void;
	private readonly previews = new Map<number, ProcessPreview>();
	private readonly interaction = new PointerInteractionController<ProcessTarget>({
		key: ({ process }) => String(process.id),
		rect: ({ row, width }) => ({ x: 0, y: row, width, height: 1 }),
	});

	constructor(
		private readonly source: ProcessTerminalStore,
		private readonly openProcess: (processId: number) => void = () => {},
		animation: Readonly<ActivityAnimationOverrides> = {},
	) {
		this.animation = animation;
		this.unsubscribe = source.subscribe(() => this.update());
	}

	setAnimation(animation: Readonly<ActivityAnimationOverrides>): void {
		this.animation = animation;
		this.motion?.dispose();
		this.motion = undefined;
		this.syncMotion();
		this.tui?.requestRender();
	}

	setUICtx(ctx: UIContext): void {
		if (ctx === this.uiCtx) return;
		this.clear();
		this.uiCtx = ctx;
		this.update();
	}

	update(): void {
		if (!this.uiCtx) return;
		const now = Date.now();
		this.updateVisible(now);
		if (this.visible.size === 0) {
			this.clearWidget();
			return;
		}
		const running = this.visibleProcesses().filter(({ state }) => state === "running");
		const status =
			running.length > 0 ? `${running.length} running process${running.length === 1 ? "" : "es"}` : undefined;
		if (status !== this.lastStatus) {
			this.uiCtx.setStatus("processes", status);
			this.lastStatus = status;
		}
		if (!this.registered) {
			this.uiCtx.setWidget(
				"processes",
				(tui, theme) => {
					this.tui = tui;
					this.syncMotion();
					this.requestSyntaxReady();
					return {
						render: (width) => this.render(theme, width),
						onMouse: (event: TuiMouseEvent) => this.onMouse(event),
						invalidate() {},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.registered = true;
		}
		this.syncMotion();
		this.tui?.requestRender();
	}

	private updateVisible(now: number): void {
		clearTimeout(this.visibilityTimer);
		this.visibilityTimer = undefined;
		const snapshots = this.source.list();
		let nextUpdate = Infinity;
		for (const [id, entry] of this.visible) {
			const process = snapshots.find((snapshot) => snapshot.id === id);
			if (process) entry.process = process;
			if (process?.state === "running") continue;
			const expiresAt = entry.shownAtMs + PROCESS_WIDGET_MIN_VISIBLE_MS;
			if (now >= expiresAt) this.visible.delete(id);
			else nextUpdate = Math.min(nextUpdate, expiresAt);
		}
		for (const process of snapshots) {
			if (process.state !== "running" || this.visible.has(process.id)) continue;
			const showAt = process.startedAtMs + PROCESS_WIDGET_DELAY_MS + 1;
			if (now >= showAt) this.visible.set(process.id, { process, shownAtMs: now });
			else nextUpdate = Math.min(nextUpdate, showAt);
		}
		if (Number.isFinite(nextUpdate)) {
			this.visibilityTimer = setTimeout(() => this.update(), nextUpdate - now);
			this.visibilityTimer.unref();
		}
	}

	private visibleProcesses(): ExecProcessSnapshot[] {
		return Array.from(this.visible.values(), ({ process }) => process);
	}

	dispose(): void {
		this.unsubscribe();
		this.clear();
		this.uiCtx = undefined;
	}

	private render(theme: HostTheme, width: number, now = Date.now()): string[] {
		const colors = tuiTheme(theme);
		const processes = this.visibleProcesses();
		const runningCount = processes.filter(({ state }) => state === "running").length;
		const rows = processes.slice(0, 4);
		this.interaction.setTargets(rows.map((process, index) => ({ process, row: index + 1, width: Math.max(0, width) })));
		const hoveredId = this.interaction.hoveredTarget()?.process.id;
		return [
			`${colors.fg("accent", `${icon("terminal")} Processes`)} ${colors.fg("text.muted", `· ${runningCount} running`)}`,
			...rows.map((process) => {
				const elapsed = formatDuration(((process.finishedAtMs ?? now) - process.startedAtMs) / 1_000);
				const state = process.state === "running" ? elapsed : `${elapsed} · exited ${process.exitCode ?? ""}`;
				const preview = this.preview(process, width);
				const marker =
					process.state === "running"
						? activityFrame(colors, "", now - process.startedAtMs, this.animation).marker
						: "";
				const command = dimmedCommand(colors, preview.commandSpans, process.id === hoveredId);
				return truncateToWidth(
					`${marker ? `${marker} ` : ""}${colors.fg(process.id === hoveredId ? "accent" : "info", `#${process.id}`)} ${colors.fg("text.muted", `${state} ·`)} ${command}${preview.outputLine ? colors.fg("text.muted", ` · ${preview.outputLine}`) : ""}`,
					width,
				);
			}),
		];
	}

	private preview(process: ExecProcessSnapshot, width: number): ProcessPreview {
		const cached = this.previews.get(process.id);
		if (
			cached?.command === process.command &&
			cached.shell === process.shell &&
			cached.output === process.output &&
			cached.width === width
		) {
			return cached;
		}
		if (!cached && this.previews.size >= 8) this.previews.clear();
		const commandSource = truncateToWidth(fieldPreview(process.command, Math.max(1, width * 2)), width);
		const preview = {
			command: process.command,
			shell: process.shell,
			output: process.output,
			width,
			commandSpans: highlightSyntaxBlock(commandSource, shellSyntaxPath(process.shell))[0] ?? [{ text: commandSource }],
			outputLine: lastOutputLine(process.output, width),
		};
		this.previews.set(process.id, preview);
		return preview;
	}

	private onMouse(event: TuiMouseEvent): boolean {
		return this.interaction.handleMouse(
			{ ...event, screenCol: event.col, screenRow: event.row },
			{
				onHoverChange: () => this.tui?.requestRender(),
				onActivate: ({ process }) => this.openProcess(process.id),
			},
		);
	}

	private syncMotion(): void {
		const running = this.visibleProcesses().some(({ state }) => state === "running");
		if (this.tui && running && !this.motion) this.motion = mountConfiguredAnimation(this.tui, this.animation);
		if (!running && this.motion) {
			this.motion.dispose();
			this.motion = undefined;
		}
	}

	private requestSyntaxReady(): void {
		if (this.syntaxReadyRequested) return;
		this.syntaxReadyRequested = true;
		whenSyntaxReady(() => this.tui?.requestRender());
	}

	private clear(): void {
		clearTimeout(this.visibilityTimer);
		this.visibilityTimer = undefined;
		this.visible.clear();
		this.clearWidget();
	}

	private clearWidget(): void {
		this.motion?.dispose();
		this.motion = undefined;
		this.tui = undefined;
		this.interaction.clear();
		this.previews.clear();
		if (this.uiCtx && this.registered) this.uiCtx.setWidget("processes", undefined);
		if (this.uiCtx && this.lastStatus !== undefined) this.uiCtx.setStatus("processes", undefined);
		this.registered = false;
		this.lastStatus = undefined;
	}
}

function dimmedCommand(
	colors: TuiTheme,
	spans: ReturnType<typeof highlightSyntaxBlock>[number],
	hovered: boolean,
): string {
	const dimAmount = hovered ? 0.35 : 0.65;
	return spans
		.map((span) =>
			colors.fg(colors.mixForeground(span.foreground ?? "text.primary", "text.muted", dimAmount), span.text),
		)
		.join("");
}

function shellSyntaxPath(shell: string): string {
	const basename = shell
		.replace(/\\/gu, "/")
		.split("/")
		.at(-1)
		?.toLowerCase()
		.replace(/\.exe$/u, "");
	return basename === "bash" || basename === "fish" || basename === "zsh" ? `script.${basename}` : "script.sh";
}

function lastOutputLine(output: string, width: number): string {
	const budget = Math.max(1, width * 2);
	const clipped = output.length > budget;
	const tail = output.slice(-budget).trimEnd();
	if (!tail) return clipped ? "…" : "";
	const newline = tail.lastIndexOf("\n");
	const prefix = clipped && newline < 0 ? "…" : "";
	return truncateToWidth(`${prefix}${sanitizeTuiField(tail.slice(newline + 1))}`, width, "…");
}

function fieldPreview(value: string, maximumCharacters: number): string {
	return sanitizeTuiFieldPreview(value, maximumCharacters);
}

function formatDuration(seconds: number): string {
	if (seconds < 10) return `${Math.max(0, seconds).toFixed(1)}s`;
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${Math.round(seconds % 60)}s`;
}
