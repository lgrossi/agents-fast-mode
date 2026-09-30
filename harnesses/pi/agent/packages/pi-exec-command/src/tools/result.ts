import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatExecResult } from "../format.ts";
import type { UnifiedExecResult } from "../session-manager.ts";
import {
	createExecToolPresentationDetails,
	type ExecToolPresentationArguments,
	type ExecToolPresentationDetails,
} from "./presentation.ts";

interface ResultInput {
	tool: "exec_command" | "write_stdin";
	phase: "partial" | "final";
	arguments: ExecToolPresentationArguments;
	command: string | undefined;
	result?: UnifiedExecResult;
}

export const EXEC_OUTPUT_SCHEMA = Type.Object(
	{
		chunk_id: Type.String({ description: "Chunk identifier included when the response reports one." }),
		wall_time_seconds: Type.Number({ description: "Elapsed wall time spent waiting for output in seconds." }),
		output: Type.String({ description: "Command output text, possibly truncated." }),
		exit_code: Type.Optional(
			Type.Integer({ description: "Process exit code when the command finished during this call." }),
		),
		session_id: Type.Optional(
			Type.Integer({ description: "Session identifier to pass to write_stdin when the process is still running." }),
		),
		original_token_count: Type.Optional(
			Type.Integer({ description: "Approximate token count before output truncation." }),
		),
		output_truncated: Type.Boolean({ description: "Whether returned output was truncated." }),
	},
	{ additionalProperties: false },
);

export function createExecToolResult(input: ResultInput): AgentToolResult<ExecToolPresentationDetails> {
	return {
		content: input.result === undefined ? [] : [{ type: "text", text: formatExecResult(input.result, input.command) }],
		...(input.result === undefined ? {} : { structuredContent: { ...input.result } }),
		details: createExecToolPresentationDetails(input),
	};
}
