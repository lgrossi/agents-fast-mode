import { generateSummaryWithUsage, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
export async function summarizeWindow(
	ctx: ExtensionContext,
	messages: AgentMessage[],
	previous?: string,
	instructions?: string,
	signal = ctx.signal,
) {
	const model = ctx.model;
	if (!model) throw new Error("Select a model before generating a context summary");
	return generateSummaryWithUsage(
		messages,
		model,
		16_384,
		undefined,
		undefined,
		signal,
		instructions,
		previous,
		"low",
		(target, context, options) =>
			ctx.modelRegistry.streamSimple(target, context, { ...options, sessionId: undefined, transport: "sse" }),
	);
}
