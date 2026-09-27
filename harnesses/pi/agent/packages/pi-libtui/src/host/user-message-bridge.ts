import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { getTuiAppearance } from "../appearance.ts";
import { nativeSurfaceCap } from "../decoration/powerline-pill.ts";

const BRIDGE_PROTOCOL = "pi-libtui/user-message-bridge/v1" as const;
const BRIDGE_KEY = Symbol.for(BRIDGE_PROTOCOL);

interface UserMessageBridge {
	readonly protocol: typeof BRIDGE_PROTOCOL;
	acquire(): () => void;
}

// type-boundary: another installed libtui copy can own this prototype lease; isBridge validates its public contract.
type UntrustedBridge = unknown;

function isBridge(value: UntrustedBridge): value is UserMessageBridge {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<UserMessageBridge>;
	return candidate.protocol === BRIDGE_PROTOCOL && typeof candidate.acquire === "function";
}

function bubbleWidth(width: number): number {
	// Narrow panes retain the native layout so markdown still has room to wrap.
	return Math.min(60, width < 40 ? width : Math.floor(width * 0.75));
}

/** Pi 0.87 has no user-message layout hook. Replace this lease when one becomes public. */
export function installUserMessageBridge(): () => void {
	const prototype = UserMessageComponent.prototype;
	const existing: UntrustedBridge = Reflect.get(prototype, BRIDGE_KEY);
	if (isBridge(existing)) return existing.acquire();
	const render = prototype.render;
	const handleMouse = prototype.handleMouse;
	const mouseDescriptor = Object.getOwnPropertyDescriptor(prototype, "handleMouse");
	let leases = 0;
	const enabled = () => leases > 0 && getTuiAppearance().userMessageBubbles;
	const wrappedRender: typeof render = function (this: UserMessageComponent, width) {
		if (!enabled()) return render.call(this, width);
		const innerWidth = bubbleWidth(width);
		if (innerWidth < 4) return render.call(this, width);
		const gutter = " ".repeat(width - innerWidth);
		// Preserve native markdown, background, transformers, and OSC message markers.
		const lines = render.call(this, innerWidth - 2).slice(1, -1);
		if (lines.length === 0) return [];
		const nerdFont = getTuiAppearance().iconPack === "nerd-fonts";
		const result = lines.map((line, index) => {
			const single = lines.length === 1;
			const first = index === 0;
			const last = index === lines.length - 1;
			// Powerline has semicircle caps but no quarter-circle corners; use diagonal corners for multiline bubbles.
			const left = nerdFont ? (single ? "" : first ? "" : last ? "" : "█") : "█";
			const right = nerdFont ? (single ? "" : first ? "" : last ? "" : "█") : "█";
			return gutter + nativeSurfaceCap(line, left) + line + nativeSurfaceCap(line, right);
		});
		result[0] = `\x1b]133;A\x07${result[0]}`;
		result[result.length - 1] += "\x1b]133;B\x07\x1b]133;C\x07";
		return result;
	};
	const wrappedMouse: typeof handleMouse = function (this: UserMessageComponent, event) {
		if (!enabled()) return handleMouse.call(this, event);
		const width = bubbleWidth(event.width);
		if (width < 4) return handleMouse.call(this, event);
		const x = event.x - (event.width - width) - 1;
		if (x < 0 || x >= width - 2) return undefined;
		return handleMouse.call(this, {
			...event,
			x,
			y: event.y + 1,
			height: event.height + 2,
			width: width - 2,
		});
	};
	const bridge: UserMessageBridge = {
		protocol: BRIDGE_PROTOCOL,
		acquire() {
			leases += 1;
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				if (--leases > 0) return;
				if (prototype.render === wrappedRender) prototype.render = render;
				if (prototype.handleMouse === wrappedMouse) {
					if (mouseDescriptor) Object.defineProperty(prototype, "handleMouse", mouseDescriptor);
					else Reflect.deleteProperty(prototype, "handleMouse");
				}
				if (Reflect.get(prototype, BRIDGE_KEY) === bridge) Reflect.deleteProperty(prototype, BRIDGE_KEY);
			};
		},
	};
	prototype.render = wrappedRender;
	prototype.handleMouse = wrappedMouse;
	Object.defineProperty(prototype, BRIDGE_KEY, { configurable: true, value: bridge });
	return bridge.acquire();
}
