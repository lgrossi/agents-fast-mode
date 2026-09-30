import { imageSettings } from "./contributions/xsettings.ts";
import {
	type ExtensionAPI,
	type ExtensionContext,
	type SessionBoundaryDraft,
	resizeImage,
} from "@earendil-works/pi-coding-agent";
import { ImageAttachmentStore } from "./core/attachments.ts";
import { createImageClamp, MAX_IMAGE_DIMENSION } from "./image-limits.ts";
import { resolveViewImageBinary } from "./native/binary.ts";
import { labelNativeImageAttachments } from "./native-attachments.ts";
import { runViewImageBinary } from "./native/view-image.ts";
import { transformPendingImageAttachments } from "./runtime/attachments.ts";
import { installImageAttachmentSession } from "./runtime/editor-attachments.ts";
import { projectImageTranscript } from "./runtime/transcript-attachments.ts";
import { configureViewImageToolForModel, createViewImageTool } from "./tools/view-image/definition.ts";

export default function viewImageExtension(pi: ExtensionAPI): void {
	const disposeSettings = imageSettings.register();
	const tool = createViewImageTool();
	const attachments = new ImageAttachmentStore();
	const legacyImages = new Set<string>();
	let clampImages = createImageClamp(async () => null, legacyImages);
	const bindLegacyImages = (ctx: ExtensionContext) => {
		legacyImages.clear();
		for (const message of ctx.sessionManager.buildSessionProjection().messages) {
			if (!("content" in message) || !Array.isArray(message.content)) continue;
			for (const block of message.content) if (block.type === "image") legacyImages.add(block.data);
		}
		// Legacy repairs use a stable cap. Model profiles apply only when Pi ingests new images.
		clampImages = createImageClamp(async (image) => {
			const resized = await resizeImage(Buffer.from(image.data, "base64"), image.mimeType, {
				maxWidth: MAX_IMAGE_DIMENSION,
				maxHeight: MAX_IMAGE_DIMENSION,
			});
			return resized?.wasResized ? { type: "image", data: resized.data, mimeType: resized.mimeType } : null;
		}, legacyImages);
	};
	pi.on("session_tree", (_event, ctx) => bindLegacyImages(ctx));
	pi.on("turn_end", async (event, ctx) => {
		const edits: SessionBoundaryDraft[] = [];
		for (const entry of ctx.sessionManager.buildSessionProjection().entries) {
			const message = entry.messages[0];
			if (
				entry.sourceEntry.type !== "message" ||
				!message ||
				(message.role !== "user" && message.role !== "toolResult")
			)
				continue;
			const replacement = (await clampImages([message]))?.[0];
			if (replacement && (replacement.role === "user" || replacement.role === "toolResult"))
				edits.push({
					type: "context_edit",
					targetId: entry.sourceEntry.id,
					replacement: { content: replacement.content },
				});
		}
		if (edits.length) return { entries: [...event.entries, ...edits] };
	});
	let removeImagePasteSession: (() => void) | undefined;
	let transcriptContext: ExtensionContext | undefined;
	pi.registerMarkdownTransformer((markdown, context) =>
		context.messageType === "user" && transcriptContext
			? projectImageTranscript(markdown, context.availableWidth, transcriptContext.ui.theme)
			: markdown,
	);
	pi.registerTool(tool);
	pi.on("session_start", (_event, context) => {
		configureViewImageToolForModel(tool, context.model);
		bindLegacyImages(context);
		attachments.clear();
		removeImagePasteSession?.();
		transcriptContext = context.mode === "tui" ? context : undefined;
		removeImagePasteSession =
			context.mode === "tui"
				? installImageAttachmentSession({
						cwd: context.cwd,
						ui: context.ui,
						getTheme: () => context.ui.theme,
						store: attachments,
					})
				: undefined;
	});
	pi.on("model_select", (event) => configureViewImageToolForModel(tool, event.model));
	pi.on("input", async (event, context) => {
		const transformed = await transformPendingImageAttachments(event, attachments, (path) =>
			resolveViewImageBinary({ onBuild: (message) => context.ui.notify(message, "info") }).then((binary) =>
				// Pasted screenshots are attached at `high` so oversized captures are resized within provider limits.
				runViewImageBinary(binary, { path, detail: "high" }, context.cwd),
			),
		);
		if (!transformed) return { action: "continue" };
		for (const failure of transformed.failures) {
			context.ui.notify(`Could not attach ${failure.path}: ${failure.message}`, "warning");
		}
		return { action: "transform", text: transformed.text, images: transformed.images };
	});
	pi.on("context", async (event) => {
		const labelled = labelNativeImageAttachments(event.messages);
		const clamped = await clampImages(labelled ?? event.messages);
		const messages = clamped ?? labelled;
		return messages ? { messages } : undefined;
	});

	pi.on("session_shutdown", () => {
		disposeSettings();
		removeImagePasteSession?.();
		removeImagePasteSession = undefined;
		transcriptContext = undefined;
		attachments.clear();
	});
}
