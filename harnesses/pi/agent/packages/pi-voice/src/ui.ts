import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { tuiTheme } from "@luan.sh/pi-libtui";
import { loadActionKeybindings, registerAction } from "@luan.sh/pi-libactions/sdk";
import type { VoiceController } from "./controller.ts";
import { renderVoiceStrip } from "./voice-strip.ts";
type VoiceAction = "toggle" | "start" | "dictate" | "mute" | "stop";
export function voiceControls(
	pi: Pick<ExtensionAPI, "registerMessageRenderer" | "registerEntryRenderer" | "registerCommand" | "on">,
	controller: Pick<
		VoiceController,
		| "status"
		| "active"
		| "recording"
		| "muted"
		| "activity"
		| "onChange"
		| "toggle"
		| "start"
		| "toggleDictation"
		| "mute"
		| "stop"
	>,
	phone: (ctx: ExtensionContext) => Promise<void>,
): () => void {
	let context: ExtensionContext | undefined;
	const bindings = loadActionKeybindings();
	const keys = {
		toggle: bindings["voice.toggle"]?.[0] ?? "/voice",
		dictate: bindings["voice.dictate"]?.[0] ?? "/voice dictate",
		mute: bindings["voice.mute"]?.[0] ?? "/voice mute",
	};
	let redraw: (() => void) | undefined;
	let mounted = false;
	let detachInput: (() => void) | undefined;
	pi.registerMessageRenderer(
		"pi-voice/transcript",
		(message, options, theme) =>
			new Text(
				`${tuiTheme(theme).fg("accent", "You · voice")}\n${typeof message.content === "string" ? message.content : ""}`,
				options.outputPad,
				0,
			),
	);
	pi.registerMessageRenderer("pi-voice/delegation", (message, options, theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		const input = (content.match(/<input>([\s\S]*?)<\/input>/u)?.[1] ?? content)
			.replaceAll("&lt;", "<")
			.replaceAll("&gt;", ">")
			.replaceAll("&amp;", "&");
		return new Text(`${tuiTheme(theme).fg("accent", "Voice request")}\n${input}`, options.outputPad, 0);
	});
	for (const [type, label] of [
		["pi-voice/transcript", "You · voice"],
		["pi-voice/reply", "Assistant · voice"],
	] as const) {
		pi.registerEntryRenderer(type, (entry, _options, theme) => {
			const data = entry.data;
			const text = data && typeof data === "object" && "text" in data && typeof data.text === "string" ? data.text : "";
			return new Text(`${tuiTheme(theme).fg("accent", label)}\n${text}`, 1, 0);
		});
	}
	const run = async (action: VoiceAction, ctx: ExtensionContext) => {
		try {
			if (action === "toggle") await controller.toggle(ctx);
			else if (action === "start") await controller.start(ctx);
			else if (action === "dictate") await controller.toggleDictation(ctx);
			else if (action === "mute") controller.mute();
			else await controller.stop();
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	};
	controller.onChange = () => {
		if (!context) return;
		if (controller.status === "off") {
			if (mounted) context.ui.setWidget("pi-voice", undefined);
			mounted = false;
			redraw = undefined;
		} else if (!mounted) {
			mounted = true;
			context.ui.setWidget(
				"pi-voice",
				(tui, theme) => {
					redraw = () => tui.requestRender();
					return { render: (width) => renderVoiceStrip(controller, keys, tuiTheme(theme), width), invalidate() {} };
				},
				{ placement: "aboveEditor" },
			);
		} else redraw?.();
	};
	pi.on("session_start", (_event, ctx) => {
		context?.ui.setWidget("pi-voice", undefined);
		context = ctx;
		mounted = false;
		redraw = undefined;
		detachInput?.();
		detachInput = ctx.ui.onTerminalInput((data) => {
			if (!controller.recording || !matchesKey(data, "escape")) return;
			void run("stop", ctx);
			return { consume: true };
		});
		controller.onChange();
	});
	pi.on("before_agent_start", (_event, ctx) => {
		context = ctx;
	});
	const descriptions = {
		toggle: "Toggle voice conversation",
		start: "Start voice conversation",
		dictate: "Start or finish dictation",
		mute: "Mute or unmute voice",
		stop: "Stop voice or cancel dictation",
	};
	const disposers = (["toggle", "start", "dictate", "mute", "stop"] as const).map((action) =>
		registerAction({
			id: `voice.${action}`,
			description: descriptions[action],
			...(action === "mute" ? { isActive: () => controller.active } : {}),
			run: (ctx) => run(action, ctx),
		}),
	);
	pi.registerCommand("voice", {
		description: "Toggle voice; or start, dictate, mute, stop",
		handler: async (args, ctx) => {
			const action = args.trim() || "toggle";
			if (action !== "toggle" && action !== "start" && action !== "dictate" && action !== "mute" && action !== "stop") {
				ctx.ui.notify("Voice actions: toggle, start, dictate, mute, stop. Connect a phone with /voice:connect", "info");
				return;
			}
			await run(action, ctx);
		},
	});
	pi.registerCommand("voice:connect", {
		description: "Connect a phone to this Pi session",
		handler: async (_args, ctx) => {
			try {
				await phone(ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
	return () => {
		controller.onChange = () => {};
		detachInput?.();
		context?.ui.setWidget("pi-voice", undefined);
		for (const dispose of disposers) dispose();
	};
}
