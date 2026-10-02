import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Box, Container } from "@earendil-works/pi-tui";

const PROTOCOL = "pi-libtui/native-tool-bridge/v1" as const;
const KEY = Symbol.for(PROTOCOL);

interface Bridge {
	readonly protocol: typeof PROTOCOL;
	acquire(): () => void;
}

// type-boundary: Pi 1.0 private tool framing and cross-realm leases; the guards below validate both shapes.
type NativeValue = unknown;

function isBridge(value: NativeValue): value is Bridge {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<Bridge>;
	return candidate.protocol === PROTOCOL && typeof candidate.acquire === "function";
}

function nativeToolBody(component: ToolExecutionComponent): Box | undefined {
	const name: NativeValue = Reflect.get(component, "toolName");
	if (name !== "codemode" && name !== "tool_search") return undefined;
	const definition: NativeValue = Reflect.get(component, "toolDefinition");
	if (!definition || typeof definition !== "object" || Reflect.get(definition, "renderShell") === "self")
		return undefined;
	const hidden: NativeValue = Reflect.get(component, "hideComponent");
	const images: NativeValue = Reflect.get(component, "imageComponents");
	const result: NativeValue = Reflect.get(component, "result");
	// Pi's fallback uses its background as the error signal; retain it until native rows have an error marker.
	if (result && typeof result === "object" && Reflect.get(result, "isError") === true) return undefined;
	// Image layout remains Pi-owned; extend only when images need compact framing.
	if (hidden !== false || !Array.isArray(images) || images.length > 0) return undefined;
	const body: NativeValue = Reflect.get(component, "contentBox");
	return body instanceof Box ? body : undefined;
}

/** Pi 1.0 has no tool-framing hook. Keep its renderers and interactions without the painted box. */
export function installNativeToolBridge(): () => void {
	const prototype = ToolExecutionComponent.prototype;
	const existing: NativeValue = Reflect.get(prototype, KEY);
	if (isBridge(existing)) return existing.acquire();
	const render = prototype.render;
	const handleMouse = prototype.handleMouse;
	let leases = 0;
	const wrappedRender: typeof render = function (this: ToolExecutionComponent, width) {
		const body = leases > 0 ? nativeToolBody(this) : undefined;
		if (!body) return render.call(this, width);
		// Bypass only Box padding/background; native components still own their content.
		const lines = Container.prototype.render.call(body, width);
		return lines.length > 0 ? ["", ...lines] : [];
	};
	const wrappedMouse: typeof handleMouse = function (this: ToolExecutionComponent, event) {
		const body = leases > 0 ? nativeToolBody(this) : undefined;
		if (!body) return handleMouse.call(this, event);
		if (event.y <= 0) return undefined;
		return Container.prototype.handleMouse.call(body, { ...event, y: event.y - 1, height: event.height - 1 });
	};
	const bridge: Bridge = {
		protocol: PROTOCOL,
		acquire() {
			leases += 1;
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				if (--leases > 0) return;
				if (prototype.render === wrappedRender) prototype.render = render;
				if (prototype.handleMouse === wrappedMouse) prototype.handleMouse = handleMouse;
				if (Reflect.get(prototype, KEY) === bridge) Reflect.deleteProperty(prototype, KEY);
			};
		},
	};
	prototype.render = wrappedRender;
	prototype.handleMouse = wrappedMouse;
	Object.defineProperty(prototype, KEY, { configurable: true, value: bridge });
	return bridge.acquire();
}
