import { isContextOverflow } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { prepareProviderCheckpoint } from "./contributions/checkpoint.ts";
import { registerContextPrompt } from "./contributions/prompt.ts";
import { contextSettings } from "./contributions/xsettings.ts";
import { latestWindow } from "./core/state.ts";
import { registerContextWindowProvider } from "./protocol/context-window.ts";
import { bindSession } from "./runtime/sessions.ts";
import { summarizeWindow } from "./runtime/summary.ts";
import { registerBranchHandoffs, TreeArchives } from "./runtime/tree.ts";
import { ContextWindows } from "./runtime/windows.ts";
import { registerHistoryTools } from "./tools/history/definition.ts";
import { registerWindowTools } from "./tools/new-context/definition.ts";
import { registerNotesTools } from "./tools/notes/definition.ts";

export default function contextExtension(pi: ExtensionAPI): void {
	let recoveryAttempted = false;
	const windows = new ContextWindows(pi),
		sessions = new Map<string, () => void>();
	const tree = new TreeArchives(pi, windows);
	registerBranchHandoffs(pi, tree);
	const disposers = [contextSettings.register(), registerContextWindowProvider(windows), registerContextPrompt(pi)];
	registerHistoryTools(pi);
	registerNotesTools(pi);
	registerWindowTools(pi, windows);
	const bind = (ctx: ExtensionContext) => {
		const id = ctx.sessionManager.getSessionId();
		for (const [previous, dispose] of sessions)
			if (previous !== id) {
				dispose();
				sessions.delete(previous);
			}
		windows.bind(ctx);
		if (!sessions.has(id)) sessions.set(id, bindSession(pi, ctx));
	};
	pi.on("session_start", (_event, ctx) => bind(ctx));
	pi.on("before_agent_start", (_event, ctx) => {
		recoveryAttempted = false;
		bind(ctx);
	});
	const commit = async (
		ctx: ExtensionContext,
		instructions?: string,
		signal = ctx.signal,
		triggerTurn = true,
	): Promise<SessionBoundaryDraft[] | undefined> => {
		if (!windows.isPending(ctx)) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const leaf = ctx.sessionManager.getLeafId();
		const generated = contextSettings.get().hybrid
			? await summarizeWindow(
					ctx,
					windows.currentMessages(ctx),
					latestWindow(ctx.sessionManager.getBranch())?.state.summary,
					instructions,
					signal,
				)
			: undefined;
		const providerCheckpoint = contextSettings.get().hybrid
			? await prepareProviderCheckpoint(ctx, windows.currentMessages(ctx), signal ?? new AbortController().signal)
			: undefined;
		signal?.throwIfAborted();
		const branch = ctx.sessionManager.getBranch();
		const boundary = leaf === null ? -1 : branch.findIndex((entry) => entry.id === leaf);
		// Settings and accounting may advance the leaf without changing the summarized conversation.
		const onlyMetadata = branch
			.slice(boundary + 1)
			.every(
				(entry) =>
					entry.type === "thinking_level_change" ||
					entry.type === "usage" ||
					entry.type === "label" ||
					entry.type === "session_info",
			);
		if (ctx.sessionManager.getSessionId() !== sessionId || (leaf !== null && boundary < 0) || !onlyMetadata)
			throw new Error("The branch changed while preparing the context summary; rollover was not applied");
		if (contextSettings.get().archiveMode === "tree")
			tree.schedule(ctx, generated?.text, triggerTurn, providerCheckpoint);
		else if (triggerTurn) {
			const drafts = windows.rollover(ctx, generated?.text, providerCheckpoint);
			for (const draft of drafts) if (draft.type === "compaction" && generated) draft.usage = generated.usage;
			return drafts;
		} else windows.commit(ctx, generated?.text, undefined, providerCheckpoint);
	};
	pi.on("turn_end", async (event, ctx) => {
		if (event.outcome !== "completed") return;
		try {
			const entries = await commit(ctx);
			if (entries?.length) return { entries: [...event.entries, ...entries], continue: true };
		} catch (error) {
			ctx.abort();
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	});
	pi.on("agent_before_settle", async (event, ctx) => {
		if (
			event.outcome !== "error" ||
			recoveryAttempted ||
			!latestWindow(ctx.sessionManager.getBranch())?.state.canonical
		)
			return;
		const last = [...ctx.sessionManager.getBranch()]
			.reverse()
			.find((entry) => entry.type === "message" && entry.message.role === "assistant");
		if (
			last?.type !== "message" ||
			last.message.role !== "assistant" ||
			!isContextOverflow(last.message) ||
			last.message.provider !== ctx.model?.provider ||
			last.message.model !== ctx.model?.id
		)
			return;
		// Retain-none windows can have no legal cut for Pi's automatic compactor. Recover once at settlement.
		recoveryAttempted = true;
		try {
			windows.request(ctx);
			const entries = await commit(ctx);
			if (entries?.length) return { entries: [...event.entries, ...entries], continue: true };
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	});
	pi.on("agent_settled", async (_event, ctx) => {
		await tree.settle(ctx);
	});
	pi.on("context", (event, ctx) => {
		try {
			bind(ctx);
			return { messages: windows.project(ctx.sessionManager.getSessionId(), event.messages) };
		} catch (error) {
			ctx.abort();
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return { messages: [] };
		}
	});
	pi.on("session_before_compact", async (event, ctx) => {
		if (event.reason === "overflow") recoveryAttempted = true;
		pi.events.emit("pi-context/compaction/v1", {
			version: 1,
			sessionId: ctx.sessionManager.getSessionId(),
			phase: "start",
		});
		try {
			bind(ctx);
			windows.request(ctx);
			await commit(ctx, event.customInstructions, event.signal, false);
			if (contextSettings.get().archiveMode === "tree") {
				await tree.settle(ctx);
				pi.events.emit("pi-context/compaction/v1", {
					version: 1,
					sessionId: ctx.sessionManager.getSessionId(),
					phase: "cancel",
				});
				// Navigation has already saved the checkpoint on its new branch.
				return { cancel: true };
			}
			return { compaction: windows.compaction(ctx) };
		} catch (error) {
			pi.events.emit("pi-context/compaction/v1", {
				version: 1,
				sessionId: ctx.sessionManager.getSessionId(),
				phase: "cancel",
			});
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return { cancel: true };
		}
	});
	pi.on("session_shutdown", (_event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		sessions.get(id)?.();
		sessions.delete(id);
		windows.forget(ctx);
		for (const dispose of disposers) dispose();
	});
}
