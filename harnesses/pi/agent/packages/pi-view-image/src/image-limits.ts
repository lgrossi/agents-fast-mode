import type { ContextEvent } from "@earendil-works/pi-coding-agent";

type AgentMessage = ContextEvent["messages"][number];
export type ImageBlock = { type: "image"; data: string; mimeType: string };

// Anthropic rejects images over 2000 px on either side once a request carries more than 20 images.
// Pi's resizeImage defaults to the same cap; keep them aligned if this changes.
export const MAX_IMAGE_DIMENSION = 2000;

/** Returns a smaller block, or null when the image already fits. */
export type ResizeImage = (image: ImageBlock) => Promise<ImageBlock | null>;

const isImageBlock = (block: unknown): block is ImageBlock =>
	typeof block === "object" &&
	block !== null &&
	Reflect.get(block, "type") === "image" &&
	typeof Reflect.get(block, "data") === "string" &&
	typeof Reflect.get(block, "mimeType") === "string";

/**
 * Repairs legacy image blocks before a request leaves. Pi encodes newly ingested images. Attach-time resizing cannot fix
 * images already in history (pasted before the fix, produced by other extensions, or by Pi itself),
 * so this runs at the model boundary. Each distinct image is decoded once and memoized for the session.
 */
export function createImageClamp(
	resize: ResizeImage,
	eligible?: ReadonlySet<string>,
): (messages: readonly AgentMessage[]) => Promise<AgentMessage[] | undefined> {
	const cache = new Map<string, Promise<ImageBlock | null>>();
	const clamp = (image: ImageBlock): Promise<ImageBlock | null> => {
		let pending = cache.get(image.data);
		if (!pending) {
			pending = resize(image).catch(() => null);
			cache.set(image.data, pending);
		}
		return pending;
	};

	return async (messages) => {
		let changed = false;
		const next = await Promise.all(
			messages.map(async (message) => {
				if (!("content" in message) || !Array.isArray(message.content)) return message;
				const content = await Promise.all(
					message.content.map(async (block: unknown) => {
						if (!isImageBlock(block) || (eligible && !eligible.has(block.data))) return block;
						const smaller = await clamp(block);
						if (!smaller) return block;
						changed = true;
						return { ...block, data: smaller.data, mimeType: smaller.mimeType };
					}),
				);
				return { ...message, content } as AgentMessage;
			}),
		);
		return changed ? next : undefined;
	};
}
