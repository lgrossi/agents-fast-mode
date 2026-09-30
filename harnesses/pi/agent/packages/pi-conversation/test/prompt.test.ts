import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderDeveloperMessages } from "@luan.sh/pi-developer-messages";
import { registerConversationPrompt, CONVERSATION_INSTRUCTIONS } from "../src/contributions/prompt.ts";

function install(sessionId: string) {
	const starts: Array<(event: never, ctx: ExtensionContext) => void> = [];
	const dispose = registerConversationPrompt({
		on: (event: string, handler: (event: never, ctx: ExtensionContext) => void) => {
			if (event === "session_start") starts.push(handler);
		},
	} as never);
	const start = (id: string) => {
		for (const handler of starts)
			handler({} as never, { sessionManager: { getSessionId: () => id } } as ExtensionContext);
	};
	start(sessionId);
	return { dispose, start };
}
function messages(sessionId: string) {
	return renderDeveloperMessages({
		sessionId,
		activeTools: ["new_context"],
		systemPromptOptions: { cwd: "/fixture" },
	}).filter((message) => message.content === CONVERSATION_INSTRUCTIONS);
}

test("reload preserves prompt bytes without merging concurrent sessions", () => {
	const first = install("prompt-root");
	const peer = install("prompt-child");
	const before = messages("prompt-root");
	expect(before).toHaveLength(1);
	expect(messages("prompt-child")).toHaveLength(1);
	// A new extension instance can register before the old instance disposes.
	const reloaded = install("prompt-root");
	first.dispose();
	try {
		expect(messages("prompt-root")).toEqual(before);
		expect(messages("prompt-child")).toHaveLength(1);
		reloaded.start("prompt-other");
		expect(messages("prompt-root")).toEqual([]);
		expect(messages("prompt-other")).toHaveLength(1);
		peer.dispose();
		expect(messages("prompt-other")).toHaveLength(1);
		reloaded.dispose();
		reloaded.start("prompt-other");
		expect(messages("prompt-other")).toHaveLength(1);
	} finally {
		first.dispose();
		peer.dispose();
		reloaded.dispose();
	}
	expect(messages("prompt-other")).toEqual([]);
});
