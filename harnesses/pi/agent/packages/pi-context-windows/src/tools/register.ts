import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { ContextToolDetails } from "./result.ts";
import { contextPresentation } from "./presentation.ts";

export function registerContextTool<Schema extends TSchema>(
	pi: ExtensionAPI,
	name: string,
	description: string,
	parameters: Schema,
	execute: (
		input: Parameters<ToolDefinition<Schema>["execute"]>[1],
		ctx: ExtensionContext,
	) => Promise<AgentToolResult<ContextToolDetails>>,
	callable = true,
): void {
	const tool: ToolDefinition<Schema, ContextToolDetails> = {
		name,
		exposure: callable ? "direct" : "model-only",
		label: name.replaceAll("__", "."),
		description,
		parameters,
		outputSchema: Type.Object({}, { additionalProperties: true }),
		...contextPresentation<Schema>(name),
		executionMode:
			name.startsWith("notes__write") || name.startsWith("notes__append") || name === "new_context"
				? "sequential"
				: "parallel",
		async execute(_id, input, _signal, _update, ctx) {
			const result = await execute(input, ctx);
			return { ...result, structuredContent: result.details.output };
		},
	};
	pi.registerTool(tool);
}
