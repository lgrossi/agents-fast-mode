import { createImageGenerationTool } from "@howaboua/pi-codex-imagegen";
import { Image, Text } from "@earendil-works/pi-tui";
import { ComponentStack, tuiTheme } from "@luan.sh/pi-libtui";
import { ToolActivity, toolCallPreview, settleToolCallPreview } from "@luan.sh/pi-libtui/tool";
export function createImagegenTool() {
	const tool = createImageGenerationTool({
		allowCodexProviderFallback: true,
		customRendering: false,
		promptSnippet: false,
	});
	return {
		...tool,
		async execute(...args: Parameters<typeof tool.execute>) {
			const result = await tool.execute(...args);
			return {
				...result,
				details: { ...result.details, version: 1, tool: "image_gen__imagegen", status: "succeeded" },
			};
		},
		name: "image_gen__imagegen",
		exposure: "model-only" as const,
		label: "Generate image",
		renderShell: "self" as const,
		description:
			"Generate or edit images using Codex credentials. Omit image selectors for a new image. For edits, provide referenced_image_paths or num_last_images_to_include, never both.",
		promptGuidelines: [
			"Inspect edit targets first. Call this tool directly to preserve generated images; never print or serialize base64 image data.",
		],
		renderCall: ((args, theme, context) =>
			context.executionStarted
				? new ComponentStack()
				: toolCallPreview(
						context.state,
						new ToolActivity({
							theme,
							requestRender: context.invalidate,
							view: { action: { verb: "Generate image", detail: args.prompt, status: "queued" } },
						}),
					)) satisfies NonNullable<typeof tool.renderCall>,
		renderResult: ((result, options, theme, context) => {
			settleToolCallPreview(context.state);
			const text = result.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			return ToolActivity.reuse(context.lastComponent, {
				theme,
				requestRender: context.invalidate,
				view: {
					action: {
						verb: context.isError ? "Image generation failed" : "Generated image",
						status: context.isError ? "failed" : "succeeded",
						detail: result.details?.path,
					},
					mode: options.expanded ? "full" : "preview",
					...(context.isError
						? { failure: text }
						: {
								payload: {
									kind: "component" as const,
									preview: new ComponentStack([
										new Text(text, 0, 0),
										...(context.showImages ? result.content.filter((part) => part.type === "image") : []).map(
											(part) =>
												new Image(
													part.data,
													part.mimeType,
													{ fallbackColor: (text) => tuiTheme(theme).fg("text.muted", text) },
													{ maxHeightCells: 16 },
												),
										),
									]),
								},
							}),
				},
			});
		}) satisfies NonNullable<typeof tool.renderResult>,
	};
}
