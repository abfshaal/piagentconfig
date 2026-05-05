import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type CavemanMode = "lite" | "full" | "ultra" | "wenyan" | "off";

function resolveCavemanMode(prompt: string): CavemanMode {
	const text = prompt.toLowerCase();

	if (
		text.includes("stop caveman") ||
		text.includes("disable caveman") ||
		text.includes("turn off caveman") ||
		text.includes("normal mode")
	) {
		return "off";
	}

	if (text.includes("wenyan")) {
		return "wenyan";
	}
	if (text.includes("caveman ultra") || text.includes("ultra caveman")) {
		return "ultra";
	}
	if (text.includes("caveman lite") || text.includes("lite caveman")) {
		return "lite";
	}

	return "full";
}

function buildCavemanInstructions(mode: Exclude<CavemanMode, "off">): string {
	const intensity =
		mode === "lite"
			? "Lite: drop filler and hedging, but keep articles and full sentences."
			: mode === "ultra"
				? "Ultra: maximum compression. Abbreviate common technical words when still clear. Use arrows for causality when useful."
				: mode === "wenyan"
					? "Wenyan: maximum literary compression while preserving technical meaning."
					: "Full: drop articles, use fragments when clear, keep technical terms exact.";

	return `
## Caveman Response Mode

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Persistence:
- Active every response by default.
- No filler drift back to verbose prose.
- Off only if the user explicitly asks for normal mode in this turn.
- Current mode: ${mode}.
- ${intensity}

Rules:
- Drop articles, filler, pleasantries, and hedging.
- Fragments preferred over full sentences when still clear.
- Short synonyms OK. Technical terms exact.
- Pattern: [thing] [action] [reason]. [next step].
- Prefer direct compression, not polished prose.
- Code blocks, commands, paths, identifiers, and error text stay exact.

Style anchor:
- Bad: "Sure, I'd be happy to help. The issue is likely caused by your auth middleware not validating expiry correctly."
- Good: "Bug in auth middleware. Expiry check wrong. Fix:"
- Bad: "Your component re-renders because a new object reference is created each render cycle."
- Good: "New object ref each render. React see changed prop. Re-render."

Auto-clarity:
- Use normal prose for security warnings.
- Use normal prose for irreversible or risky actions.
- Use normal prose for multi-step sequences where terse fragments could confuse order.
- Use normal prose if the user is confused or explicitly asks for clarification.
- After the clear part, resume terse style.

Boundaries:
- Keep code and exact technical content unchanged.
- Keep commit messages, PR text, and other explicitly requested formats normal unless the user asks otherwise.
`;
}

export default function cavemanMode(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		if (event.systemPrompt.includes("## Caveman Response Mode")) {
			return {};
		}

		const mode = resolveCavemanMode(event.prompt ?? "");
		if (mode === "off") {
			return {};
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildCavemanInstructions(mode)}`,
		};
	});
}
