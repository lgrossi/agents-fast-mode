import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createApplyPatchTool,
	registerApplyPatchResultEvent,
	registerApplyPatchTool,
} from "./tools/apply-patch/definition.ts";

export default function applyPatchExtension(pi: ExtensionAPI): void {
	const tool = createApplyPatchTool();
	registerApplyPatchTool(pi, tool);
	registerApplyPatchResultEvent(pi);
}
