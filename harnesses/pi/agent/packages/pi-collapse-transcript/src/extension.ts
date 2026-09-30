import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mountTranscriptProjection } from "@luan.sh/pi-libtui/tool";
import { ActivityTimings } from "./activity-timing.ts";
import { ActivityTranscript } from "./activity-transcript.ts";

export default function transcriptExtension(pi: ExtensionAPI): void {
	let unmount: (() => void) | undefined;
	let transcript: ActivityTranscript | undefined;
	pi.on("agent_start", () => transcript?.beginTurn());
	pi.on("agent_settled", () => transcript?.finishTurn());
	pi.on("session_start", (_event, ctx) => {
		unmount?.();
		unmount = undefined;
		transcript = undefined;
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		ctx.ui.setWidget("pi-collapse-transcript.host", (tui, theme) => {
			unmount?.();
			const timings = new ActivityTimings();
			let previousLeaf: string | null | undefined;
			const release = mountTranscriptProjection(tui, (entries) => {
				transcript = new ActivityTranscript(
					() => {
						const leaf = ctx.sessionManager.getLeafId();
						if (leaf !== previousLeaf) {
							timings.load(ctx.sessionManager.getBranch());
							previousLeaf = leaf;
						}
						return entries();
					},
					theme,
					() => tui.requestRender(),
					timings,
				);
				return transcript;
			});
			unmount = release;
			return {
				render: () => [],
				invalidate() {},
				dispose: () => {
					release?.();
					if (unmount === release) unmount = undefined;
				},
			};
		});
	});
	pi.on("session_shutdown", (_event, ctx) => {
		unmount?.();
		unmount = undefined;
		transcript = undefined;
		if (ctx.hasUI && ctx.mode === "tui") ctx.ui.setWidget("pi-collapse-transcript.host", undefined);
	});
}
