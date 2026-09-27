import type { Theme } from "@earendil-works/pi-coding-agent";
import { markdownCodeRanges, renderEditorTokenPills } from "@luan.sh/pi-libtui";
import {
	type EditorRegistry,
	type EditorUi,
	ensureEditorRegistry,
	installEditorLayer,
	SemanticEditor,
} from "@luan.sh/pi-libtui/editor";
import type { ImageAttachmentStore } from "../core/attachments.ts";
import { pastedImagePath } from "../core/attachments.ts";

export interface ImageAttachmentSession {
	cwd: string;
	ui: EditorUi;
	getTheme(): Theme;
	store: ImageAttachmentStore;
}

/** Register image attachments with pi-libtui's shared atomic editor-token path. */
export function installImageAttachmentSession(
	session: ImageAttachmentSession,
	registry: EditorRegistry = ensureEditorRegistry(),
): () => void {
	const removeEditor = installEditorLayer(
		session.ui,
		Symbol.for("pi-view-image/editor-layer"),
		(previous) => (tui, theme, keys) => {
			const editor = previous?.(tui, theme, keys) ?? new SemanticEditor(tui, session.getTheme(), keys);
			const setText = editor.setText.bind(editor);
			const getExpandedText = editor.getExpandedText?.bind(editor) ?? editor.getText.bind(editor);
			editor.setText = (text) => setText(restoreImageAttachments(text, session.store));
			editor.getExpandedText = () => session.store.expand(getExpandedText());
			return editor;
		},
	);
	const removePasteHandler = registry.registerPasteHandler({
		id: "pi-view-image.attach-pasted-image",
		handle(text) {
			const path = pastedImagePath(text, session.cwd);
			return path ? `${session.store.add(path)} ` : undefined;
		},
	});
	const removeRenderDecorator = registry.registerRenderDecorator({
		id: "pi-view-image.render-attachment-tokens",
		decorate(lines, width) {
			const tokens = session.store.presentations(lines.join("\n"));
			return tokens.length === 0 ? [...lines] : renderEditorTokenPills(lines, width, session.getTheme(), tokens).lines;
		},
	});
	return () => {
		removeEditor();
		removeRenderDecorator();
		removePasteHandler();
	};
}

/** Rebuild editor atoms without requiring the image to still exist on disk. Submit reports missing files. */
function restoreImageAttachments(text: string, store: ImageAttachmentStore): string {
	const lines = text.split("\n");
	const excluded = markdownCodeRanges(lines);
	return lines
		.map((line, row) =>
			line.replace(
				/<file name="([^"\r\n]+\.(?:bmp|gif|jpe?g|png|webp))"><\/file>/gi,
				(tag, path: string, offset: number) => {
					if (excluded[row]?.some((range) => offset < range.end && range.start < offset + tag.length)) return tag;
					const decoded = path.replace(/&(quot|lt|gt|amp);/g, (entity) => {
						switch (entity) {
							case "&quot;":
								return '"';
							case "&lt;":
								return "<";
							case "&gt;":
								return ">";
							default:
								return "&";
						}
					});
					return store.add(decoded);
				},
			),
		)
		.join("\n");
}
