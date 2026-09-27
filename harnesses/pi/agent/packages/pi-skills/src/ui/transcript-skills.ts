import type { Theme } from "@earendil-works/pi-coding-agent";
import { markdownCodeRanges, renderTranscriptPill } from "@luan.sh/pi-libtui";
import type { SkillReference } from "../skills.ts";

const SKILL_REFERENCE = /(?:^|\s)(\$[a-zA-Z][\w-]*(?::[\w-]+)*)/gu;

/** Replace known references before Pi parses Markdown, leaving code literal. */
export function projectSkillTranscript(
	markdown: string,
	skills: ReadonlyMap<string, SkillReference>,
	width: number,
	theme: Theme,
): string {
	const lines = markdown.split("\n");
	const excluded = markdownCodeRanges(lines);
	return lines
		.map((line, row) =>
			line.replace(SKILL_REFERENCE, (match, token: string, offset: number) => {
				const start = offset + match.length - token.length;
				if (excluded[row]?.some((range) => start < range.end && range.start < start + token.length)) return match;
				const skill = skills.get(token.slice(1));
				return skill
					? match.slice(0, match.length - token.length) +
							renderTranscriptPill(
								theme,
								{ icon: "lightbulb", iconTone: "accent", label: skill.displayName ?? skill.name },
								width,
							)
					: match;
			}),
		)
		.join("\n");
}
