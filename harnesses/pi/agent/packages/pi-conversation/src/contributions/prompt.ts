import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPromptEnvelopeService, registerDeveloperMessageContribution } from "@luan.sh/pi-developer-messages";
import { undeliveredAnswers } from "../core/state.ts";

export const CONVERSATION_INSTRUCTIONS = `<conversation_controls>
Use async questions, user messages, and sleep as needed during ordinary work; they do not require persistent mode. The user does not need to name tools or run commands. Questions appear inline with clickable choices, a free-text field, and a Dismiss control.
Ask optional questions early and continue independent work. Required answers and approvals must arrive before dependent work proceeds. Use send_message_to_user_async for a substantive answer while work continues; avoid duplicating it in commentary or the final response. Use clock__sleep to wait for a relevant outcome; new user input wakes it early.
</conversation_controls>`;
export function registerConversationPrompt(pi: ExtensionAPI): () => void {
	let dispose = () => {};
	let registeredSession: string | undefined;
	const activate = (ctx: ExtensionContext) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (registeredSession === sessionId) return;
		dispose();
		registeredSession = sessionId;
		// IDs are serialized into the prompt: reloads must preserve them.
		dispose = registerDeveloperMessageContribution({
			id: `pi-conversation/instructions/${sessionId}`,
			priority: 35,
			content: ({ sessionId: current }) => (current === registeredSession ? CONVERSATION_INSTRUCTIONS : undefined),
		});
	};
	pi.on("session_start", (_event, ctx) => activate(ctx));
	pi.on("before_agent_start", (event, ctx) => {
		activate(ctx);
		return !getPromptEnvelopeService()
			? { systemPrompt: `${event.systemPrompt}\n\n${CONVERSATION_INSTRUCTIONS}` }
			: undefined;
	});
	pi.on("context", (event, ctx) => ({
		messages: [
			...event.messages,
			...undeliveredAnswers(ctx.sessionManager.getBranch()).map((content) => ({
				role: "custom" as const,
				customType: "pi-conversation/recovered-answer",
				content,
				display: false,
				timestamp: 0,
			})),
		],
	}));
	pi.on("session_shutdown", (_event, ctx) => {
		if (registeredSession === ctx.sessionManager.getSessionId()) registeredSession = undefined;
	});
	return () => {
		dispose();
		registeredSession = undefined;
	};
}
