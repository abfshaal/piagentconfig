import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type FrontendDesignState = {
	active: boolean;
	savedTools?: string[];
};

const STATE_TYPE = "frontend-design-mode";
const MODE_TOOLS = [
	"read",
	"bash",
	"write",
	"edit",
	"ask_user_question",
	"web_search",
	"web_fetch",
	"fetch_url",
	"subagent",
];

const MODE_PROMPT = `[FRONTEND DESIGN MODE]
You are in frontend design mode: a conversational, gated workflow for designing clickable static HTML prototypes.

Do not immediately build prototypes unless the user explicitly says "build now", "skip gates", or gives enough design direction and asks to generate.

Use tags exactly:
- [MODE:FRONTEND-DESIGN:DISCOVERY]
- [MODE:FRONTEND-DESIGN:BRIEF]
- [MODE:FRONTEND-DESIGN:DIRECTIONS]
- [MODE:FRONTEND-DESIGN:PROTOTYPE]
- [DESIGN-BRIEF-READY:path]
- [DESIGN-DIRECTIONS-READY:path]
- [DESIGN-PROTOTYPE-READY:path]
- [DESIGN-BLOCKED]

Hard rules:
- Use ask_user_question for design-critical questions.
- Ask exactly one question per tool call.
- Prefer multiple-choice options for subjective design choices.
- Do not ask low-value questions; infer and record assumptions when safe.
- Do not generate production app code. Generate static clickable HTML/CSS/JS prototypes unless user asks otherwise.
- Do not edit unrelated project files.
- Use files for artifacts. Do not paste long briefs/specs into chat.
- Keep responses short: mode tag, artifact path, next gate or next question.

Design principles to clarify or infer when material:
1. User + job: who uses this, what job they need done, what success moment matters most.
2. Primary action: one action the screen/flow should drive.
3. Brand personality: 2-3 adjectives like trusted, premium, playful, editorial, technical, warm, rebellious, calm.
4. Aesthetic direction: visual references, genre, mood, and "not like X" constraints.
5. Information density: sparse/premium vs dense/operational.
6. Visual hierarchy: what must be noticed first, second, third.
7. Content realism: domain-specific sample data, copy tone, empty/error/loading/success states.
8. Interaction feel: fast/utilitarian, cinematic, playful, quiet, guided.
9. Device priority: mobile-first, desktop dashboard, responsive equal priority, kiosk/tablet, etc.
10. Accessibility constraints: contrast, keyboard use, motion sensitivity, readability, localization.
11. Port-to-code constraints: plain HTML only, future React/Tailwind/shadcn, existing design system, or no preference.

Workflow:
1. Discovery: parse user prompt into known facts and missing design principles. Ask one high-leverage question if needed.
2. Brief: write designs/brief.md with product goal, users/jobs, primary action, principles/assumptions, aesthetic direction, constraints, and next gate. Stop with [DESIGN-BRIEF-READY:designs/brief.md].
3. Directions: after brief approval, write designs/directions.md with 1-3 directions. Search/fetch references when useful and cite them. Stop with [DESIGN-DIRECTIONS-READY:designs/directions.md].
4. Prototype: after direction approval, use frontend-design-agent subagent if available; otherwise build directly. Generate clickable static HTML/CSS/JS under designs/, with designs/index.html as hub and designs/handoff.md for port-to-code notes. Stop with [DESIGN-PROTOTYPE-READY:designs/index.html].

Default first high-leverage question when prompt is vague: ask which design direction to optimize for, with options Trusted/premium, Playful/consumer, Dense/operational, Bold/editorial, Other.

Exit mode only when user says: exit frontend design mode, stop design mode, normal mode, or clearly switches tasks.`;

function updateUi(ctx: ExtensionContext, active: boolean): void {
	ctx.ui.setStatus("frontend-design", active ? "🎨 design" : undefined);
}

export default function frontendDesignMode(pi: ExtensionAPI) {
	let state: FrontendDesignState = { active: false };

	function persist(): void {
		pi.appendEntry(STATE_TYPE, state);
	}

	function enable(ctx: ExtensionContext): void {
		if (!state.active) {
			state = { active: true, savedTools: pi.getActiveTools() };
		}
		const tools = new Set(state.savedTools ?? pi.getActiveTools());
		for (const tool of MODE_TOOLS) tools.add(tool);
		pi.setActiveTools([...tools]);
		updateUi(ctx, true);
		persist();
		ctx.ui.notify("Frontend design mode enabled. Describe the design problem, or approve a gate when ready.", "info");
	}

	function disable(ctx: ExtensionContext): void {
		if (state.savedTools) pi.setActiveTools(state.savedTools);
		state = { active: false };
		updateUi(ctx, false);
		persist();
		ctx.ui.notify("Frontend design mode disabled.", "info");
	}

	function toggle(ctx: ExtensionContext, args: string): void {
		if (state.active && !args.trim()) {
			disable(ctx);
			return;
		}
		enable(ctx);
		const prompt = args.trim();
		if (prompt) {
			pi.sendUserMessage(prompt);
		}
	}

	pi.registerCommand("frontend-design", {
		description: "Toggle frontend design mode",
		handler: async (args, ctx) => toggle(ctx, args),
	});

	pi.registerCommand("frontend-design-status", {
		description: "Show frontend design mode status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(state.active ? "Frontend design mode: active" : "Frontend design mode: inactive", "info");
		},
	});

	pi.on("input", async (event, ctx) => {
		if (!state.active || event.source === "extension") return { action: "continue" };
		const text = event.text.trim().toLowerCase();
		if (["exit frontend design mode", "stop design mode", "normal mode"].includes(text)) {
			disable(ctx);
			return { action: "handled" };
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", async () => {
		if (!state.active) return undefined;
		return {
			message: {
				customType: "frontend-design-mode-context",
				content: MODE_PROMPT,
				display: false,
			},
		};
	});

	pi.on("context", async (event) => {
		if (state.active) return undefined;
		return {
			messages: event.messages.filter((message) => {
				const msg = message as { customType?: string; role?: string; content?: unknown };
				if (msg.customType === "frontend-design-mode-context") return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") return !content.includes("[FRONTEND DESIGN MODE]");
				if (Array.isArray(content)) {
					return !content.some(
						(part) =>
							part &&
							typeof part === "object" &&
							"type" in part &&
							(part as { type?: string; text?: string }).type === "text" &&
							(part as { text?: string }).text?.includes("[FRONTEND DESIGN MODE]"),
					);
				}
				return true;
			}),
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const latest = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_TYPE)
			.pop() as { data?: FrontendDesignState } | undefined;
		if (latest?.data) state = latest.data;
		if (state.active) {
			const tools = new Set(state.savedTools ?? pi.getActiveTools());
			for (const tool of MODE_TOOLS) tools.add(tool);
			pi.setActiveTools([...tools]);
		}
		updateUi(ctx, state.active);
	});
}
