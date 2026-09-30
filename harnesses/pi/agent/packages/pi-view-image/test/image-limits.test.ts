import { describe, expect, test } from "bun:test";
import { createImageClamp, type ImageBlock } from "../src/image-limits.ts";

const image = (data: string): ImageBlock => ({ type: "image", data, mimeType: "image/png" });
const smaller = (block: ImageBlock): ImageBlock => ({
	type: "image",
	data: `small:${block.data}`,
	mimeType: "image/jpeg",
});

describe("image clamp", () => {
	test("replaces oversized images in user and tool-result messages, once per distinct image", async () => {
		const seen: string[] = [];
		const clamp = createImageClamp(async (block) => {
			seen.push(block.data);
			return block.data.startsWith("big") ? smaller(block) : null;
		});
		const messages = [
			{ role: "user", content: [{ type: "text", text: "look" }, image("big-1"), image("fits")], timestamp: 1 },
			{
				role: "toolResult",
				toolCallId: "t",
				toolName: "read",
				content: [image("big-1"), image("big-2")],
				isError: false,
				timestamp: 2,
			},
		] as never[];

		const first = await clamp(messages);
		expect(first?.map((message) => Reflect.get(message, "content"))).toEqual([
			[{ type: "text", text: "look" }, { type: "image", data: "small:big-1", mimeType: "image/jpeg" }, image("fits")],
			[
				{ type: "image", data: "small:big-1", mimeType: "image/jpeg" },
				{ type: "image", data: "small:big-2", mimeType: "image/jpeg" },
			],
		]);

		await clamp(messages);
		expect(seen.sort()).toEqual(["big-1", "big-2", "fits"]);
	});

	test("returns undefined when nothing needs resizing and tolerates resize failures", async () => {
		const clamp = createImageClamp(async () => {
			throw new Error("decoder unavailable");
		});
		const messages = [{ role: "user", content: [image("any")], timestamp: 1 }] as never[];
		expect(await clamp(messages)).toBeUndefined();
	});
});

test("legacy repair leaves newly ingested images to Pi's model profile", async () => {
	const resized: string[] = [];
	const clamp = createImageClamp(
		async (block) => {
			resized.push(block.data);
			return smaller(block);
		},
		new Set(["old"]),
	);
	const messages = [{ role: "user" as const, content: [image("old"), image("new")], timestamp: 1 }];
	expect((await clamp(messages))?.[0]).toMatchObject({ content: [smaller(image("old")), image("new")] });
	expect(resized).toEqual(["old"]);
});
