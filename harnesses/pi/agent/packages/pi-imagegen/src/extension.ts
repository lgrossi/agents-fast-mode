import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createImagegenTool } from "./tools/imagegen/definition.ts";
export default function imagegenExtension(pi: ExtensionAPI): void {
	const tool = createImagegenTool();
	pi.registerTool(tool);
}
