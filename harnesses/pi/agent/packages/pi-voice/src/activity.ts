export interface VoiceAudioLevels {
	microphone: number;
	speaker: number;
}

/** Bounded display data; captions never replace the editor draft or persisted turns. */
export class VoiceActivity {
	microphone: number[] = [];
	speaker: number[] = [];
	captions = { user: "", assistant: "" };

	levels(levels: VoiceAudioLevels): void {
		this.microphone = [...this.microphone.slice(-5), levels.microphone];
		this.speaker = [...this.speaker.slice(-5), levels.speaker];
	}

	caption(role: "user" | "assistant", delta: string, final: boolean): void {
		this.captions[role] = final
			? ""
			: Array.from(this.captions[role] + delta)
					.slice(-2048)
					.join("");
	}

	mute(): void {
		this.microphone.fill(0);
	}

	clear(): void {
		this.microphone = [];
		this.speaker = [];
		this.captions = { user: "", assistant: "" };
	}
}
