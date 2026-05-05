import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type AnyMessage = {
	role?: string;
	content?: unknown;
	timestamp?: number;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	details?: unknown;
};

type AnyEntry = {
	type: string;
	id?: string;
	timestamp?: string;
	message?: AnyMessage;
};

type Turn = {
	index: number;
	entryId: string;
	timestamp?: string;
	userText: string;
	assistantText: string;
	thinkingText: string;
	toolCalls: Array<{ name: string; args?: unknown }>;
	toolResults: Array<{ name: string; text: string; isError?: boolean }>;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const padRight = (text: string, width: number) => {
	const visible = visibleWidth(text);
	return text + " ".repeat(Math.max(0, width - visible));
};

const row = (theme: Theme, content: string, width: number) => {
	const innerWidth = Math.max(1, width - 2);
	const safe = truncateToWidth(content, innerWidth, "…");
	return theme.fg("border", "│") + padRight(safe, innerWidth) + theme.fg("border", "│");
};

const border = (theme: Theme, left: string, fill: string, right: string, width: number) => {
	const innerWidth = Math.max(1, width - 2);
	return theme.fg("border", left + fill.repeat(innerWidth) + right);
};

const extractTextParts = (content: unknown): string[] => {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as { type?: string; text?: unknown };
		if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
	}
	return parts;
};

const extractThinkingParts = (content: unknown): string[] => {
	if (!Array.isArray(content)) return [];

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as { type?: string; thinking?: unknown };
		if (b.type === "thinking" && typeof b.thinking === "string") parts.push(b.thinking);
	}
	return parts;
};

const extractToolCalls = (content: unknown): Array<{ name: string; args?: unknown }> => {
	if (!Array.isArray(content)) return [];

	const calls: Array<{ name: string; args?: unknown }> = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as { type?: string; name?: unknown; arguments?: unknown };
		if (b.type === "toolCall" && typeof b.name === "string") calls.push({ name: b.name, args: b.arguments });
	}
	return calls;
};

const shortText = (value: string, max = 120) => {
	const oneLine = value.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
};

const safeJson = (value: unknown, max = 300) => {
	try {
		const text = JSON.stringify(value);
		if (!text) return "";
		return text.length > max ? text.slice(0, max - 1) + "…" : text;
	} catch {
		return "[unserializable]";
	}
};

const buildTurns = (entries: AnyEntry[]): Turn[] => {
	const turns: Turn[] = [];
	let current: Turn | undefined;

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;

		const msg = entry.message;
		if (msg.role === "user") {
			const userText = extractTextParts(msg.content).join("\n").trim();
			if (!userText) continue;

			current = {
				index: turns.length + 1,
				entryId: entry.id ?? `turn-${turns.length + 1}`,
				timestamp: entry.timestamp,
				userText,
				assistantText: "",
				thinkingText: "",
				toolCalls: [],
				toolResults: [],
			};
			turns.push(current);
			continue;
		}

		if (!current) continue;

		if (msg.role === "assistant") {
			const assistantText = extractTextParts(msg.content).join("\n").trim();
			const thinkingText = extractThinkingParts(msg.content).join("\n").trim();
			if (assistantText) {
				current.assistantText += (current.assistantText ? "\n\n" : "") + assistantText;
			}
			if (thinkingText) {
				current.thinkingText += (current.thinkingText ? "\n\n" : "") + thinkingText;
			}
			current.toolCalls.push(...extractToolCalls(msg.content));
			continue;
		}

		if (msg.role === "toolResult") {
			const text = extractTextParts(msg.content).join("\n").trim();
			current.toolResults.push({
				name: msg.toolName ?? "tool",
				text,
				isError: msg.isError,
			});
		}
	}

	return turns;
};

const turnTitle = (turn: Turn) => shortText(turn.userText, 80) || `(turn ${turn.index})`;

const parseMermaidLabel = (raw: string | undefined) => {
	if (!raw) return undefined;
	let label = raw.trim();
	label = label.replace(/^[[({]+|[\])}]+$/g, "");
	label = label.replace(/^"|"$/g, "");
	label = label.replace(/<br\s*\/?>(\s*)/gi, " / ");
	label = label.replace(/`/g, "\\`");
	return label.replace(/\s+/g, " ").trim() || undefined;
};

const parseMermaidBlock = (source: string) => {
	const lines = source
		.split("\n")
		.map((line) => line.trim().replace(/;$/, ""))
		.filter((line) => line && !line.startsWith("%%"));
	const header = lines.find((line) => /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt)\b/i.test(line));
	const nodes = new Map<string, string>();
	const edges: Array<{ from: string; to: string; label?: string }> = [];
	const nodePattern = /\b([A-Za-z][\w-]*)\s*(\[[^\]]*\]|\{[^}]*\}|\(\([^)]*\)\)|\([^)]*\))/g;
	const edgePattern = /^([A-Za-z][\w-]*)(?:\s*(\[[^\]]*\]|\{[^}]*\}|\(\([^)]*\)\)|\([^)]*\)))?\s*(?:--\s*([^>-]+?)\s*-->|-->|---|==>|-.->)\s*([A-Za-z][\w-]*)(?:\s*(\[[^\]]*\]|\{[^}]*\}|\(\([^)]*\)\)|\([^)]*\)))?/;

	for (const line of lines) {
		for (const match of line.matchAll(nodePattern)) {
			const id = match[1]!;
			const label = parseMermaidLabel(match[2]);
			if (label) nodes.set(id, label);
		}

		const edge = line.match(edgePattern);
		if (!edge) continue;
		const from = edge[1]!;
		const fromLabel = parseMermaidLabel(edge[2]);
		const label = parseMermaidLabel(edge[3]);
		const to = edge[4]!;
		const toLabel = parseMermaidLabel(edge[5]);
		if (fromLabel) nodes.set(from, fromLabel);
		if (toLabel) nodes.set(to, toLabel);
		edges.push({ from, to, label });
	}

	return { header, nodes, edges };
};

const renderMermaidPreview = (source: string) => {
	const parsed = parseMermaidBlock(source);
	const out: string[] = [];
	out.push(`### Mermaid diagram preview${parsed.header ? ` — \`${parsed.header}\`` : ""}`);
	out.push("");
	out.push("_Terminal preview. Source kept below._");
	out.push("");

	if (parsed.edges.length > 0) {
		out.push("**Edges**");
		for (const edge of parsed.edges) {
			const from = parsed.nodes.get(edge.from) ?? edge.from;
			const to = parsed.nodes.get(edge.to) ?? edge.to;
			const label = edge.label ? ` --${edge.label}→ ` : " → ";
			out.push(`- \`${edge.from}\` ${from}${label}\`${edge.to}\` ${to}`);
		}
		out.push("");
	}

	if (parsed.nodes.size > 0) {
		out.push("**Nodes**");
		for (const [id, label] of parsed.nodes) out.push(`- \`${id}\`: ${label}`);
		out.push("");
	}

	if (parsed.edges.length === 0 && parsed.nodes.size === 0) {
		out.push("_No flowchart edges parsed. Showing source only._");
		out.push("");
	}

	out.push("**Mermaid source**");
	out.push("```mermaid");
	out.push(source.trim());
	out.push("```");
	return out.join("\n");
};

const enhanceMermaidBlocks = (markdown: string) =>
	markdown.replace(/```mermaid\s*\n([\s\S]*?)```/gi, (_match, source: string) => renderMermaidPreview(source));

const buildTurnMarkdown = (turn: Turn) => {
	const sections: string[] = [];
	sections.push(`# Turn ${turn.index}`);
	if (turn.timestamp) sections.push(`_${new Date(turn.timestamp).toLocaleString()}_`);
	sections.push(`## User\n\n${turn.userText}`);

	if (turn.assistantText.trim()) {
		sections.push(`## Assistant\n\n${turn.assistantText.trim()}`);
	} else {
		sections.push(`## Assistant\n\n_No assistant text yet._`);
	}

	if (turn.toolCalls.length > 0 || turn.toolResults.length > 0) {
		const lines: string[] = [];
		if (turn.toolCalls.length > 0) {
			lines.push("### Tool calls");
			for (const call of turn.toolCalls) {
				const args = safeJson(call.args, 220);
				lines.push(`- \`${call.name}\`${args ? ` ${args}` : ""}`);
			}
		}
		if (turn.toolResults.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push("### Tool results");
			for (const result of turn.toolResults) {
				const label = result.isError ? `\`${result.name}\` error` : `\`${result.name}\``;
				const text = result.text ? shortText(result.text, 500) : "(no text output)";
				lines.push(`- ${label}: ${text}`);
			}
		}
		sections.push(`## Tools\n\n${lines.join("\n")}`);
	}

	return sections.join("\n\n");
};

class TurnListOverlay {
	private selected = 0;
	private scroll = 0;
	private pendingG = false;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private turns: Turn[],
		private theme: Theme,
		private done: (turn: Turn | undefined) => void,
		initialSelected = 0,
	) {
		this.selected = clamp(initialSelected, 0, Math.max(0, turns.length - 1));
		this.ensureVisible();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "h") {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "l") {
			this.done(this.turns[this.selected]);
			return;
		}

		const page = this.visibleRows();
		const halfPage = Math.max(1, Math.floor(page / 2));
		if (this.pendingG) {
			this.pendingG = false;
			if (data === "g") this.selected = 0;
			else return;
		} else if (data === "g") {
			this.pendingG = true;
			return;
		} else if (data === "G") this.selected = this.turns.length - 1;
		else if (matchesKey(data, "up") || data === "k") this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "down") || data === "j") this.selected = Math.min(this.turns.length - 1, this.selected + 1);
		else if (matchesKey(data, "pageup") || matchesKey(data, "ctrl+b")) this.selected = Math.max(0, this.selected - page);
		else if (matchesKey(data, "pagedown") || matchesKey(data, "ctrl+f")) this.selected = Math.min(this.turns.length - 1, this.selected + page);
		else if (matchesKey(data, "ctrl+u")) this.selected = Math.max(0, this.selected - halfPage);
		else if (matchesKey(data, "ctrl+d")) this.selected = Math.min(this.turns.length - 1, this.selected + halfPage);
		else if (matchesKey(data, "home")) this.selected = 0;
		else if (matchesKey(data, "end")) this.selected = this.turns.length - 1;
		else return;

		this.ensureVisible();
		this.invalidate();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const th = this.theme;
		const w = Math.max(40, width);
		const bodyRows = this.visibleRows();
		this.ensureVisible();

		const lines: string[] = [];
		lines.push(border(th, "╭", "─", "╮", w));
		lines.push(row(th, ` ${th.fg("accent", th.bold("Turns"))} ${th.fg("dim", `${this.turns.length} prompts`)}`, w));
		lines.push(row(th, "", w));

		if (this.turns.length === 0) {
			lines.push(row(th, ` ${th.fg("warning", "No user prompts in current branch yet.")}`, w));
		} else {
			const visible = this.turns.slice(this.scroll, this.scroll + bodyRows);
			for (const turn of visible) {
				const selected = turn.index - 1 === this.selected;
				const prefix = selected ? th.fg("accent", "▶") : " ";
				const toolCount = turn.toolCalls.length;
				const answer = turn.assistantText.trim() ? th.fg("success", "✓") : th.fg("dim", "…");
				const meta = `${answer} ${toolCount ? th.fg("muted", `${toolCount} tools`) : th.fg("dim", "no tools")}`;
				const label = selected ? th.fg("accent", turnTitle(turn)) : th.fg("text", turnTitle(turn));
				lines.push(row(th, ` ${prefix} ${String(turn.index).padStart(2, "0")} ${label} ${th.fg("dim", "·")} ${meta}`, w));
			}
		}

		lines.push(row(th, "", w));
		const moreTop = this.scroll > 0 ? `↑ ${this.scroll} ` : "";
		const below = Math.max(0, this.turns.length - (this.scroll + bodyRows));
		const moreBottom = below > 0 ? `↓ ${below} ` : "";
		lines.push(row(th, ` ${th.fg("dim", `${moreTop}${moreBottom}j/k move • Ctrl-d/u half • gg/G top/end • l open • h/q close`)}`, w));
		lines.push(border(th, "╰", "─", "╯", w));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private visibleRows(): number {
		const rows = process.stdout.rows || 30;
		return clamp(rows - 10, 6, 24);
	}

	private ensureVisible(): void {
		const rows = this.visibleRows();
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + rows) this.scroll = this.selected - rows + 1;
		this.scroll = clamp(this.scroll, 0, Math.max(0, this.turns.length - rows));
	}
}

class TurnViewerOverlay {
	private scroll = 0;
	private pendingG = false;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private cachedBodyWidth?: number;
	private renderedBody?: string[];

	constructor(
		private turn: Turn,
		private theme: Theme,
		private done: (action: "back" | "close") => void,
	) {}

	handleInput(data: string): void {
		const page = this.visibleBodyRows();
		const halfPage = Math.max(1, Math.floor(page / 2));
		if (matchesKey(data, "escape") || data === "h") {
			this.done("back");
			return;
		}
		if (matchesKey(data, "ctrl+c") || data === "q") {
			this.done("close");
			return;
		}
		if (this.pendingG) {
			this.pendingG = false;
			if (data === "g") this.scroll = 0;
			else return;
		} else if (data === "g") {
			this.pendingG = true;
			return;
		} else if (data === "G") this.scroll = Number.MAX_SAFE_INTEGER;
		else if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
		else if (matchesKey(data, "down") || data === "j") this.scroll += 1;
		else if (matchesKey(data, "pageup") || matchesKey(data, "ctrl+b")) this.scroll = Math.max(0, this.scroll - page);
		else if (matchesKey(data, "pagedown") || matchesKey(data, "ctrl+f") || data === " ") this.scroll += page;
		else if (matchesKey(data, "ctrl+u")) this.scroll = Math.max(0, this.scroll - halfPage);
		else if (matchesKey(data, "ctrl+d")) this.scroll += halfPage;
		else if (matchesKey(data, "home")) this.scroll = 0;
		else if (matchesKey(data, "end")) this.scroll = Number.MAX_SAFE_INTEGER;
		else return;
		this.invalidate();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const th = this.theme;
		const w = Math.max(50, width);
		const innerWidth = Math.max(1, w - 2);
		const bodyWidth = Math.max(1, innerWidth - 2);
		const bodyRows = this.visibleBodyRows();
		const body = this.getBodyLines(bodyWidth);
		const maxScroll = Math.max(0, body.length - bodyRows);
		this.scroll = clamp(this.scroll, 0, maxScroll);
		const visible = body.slice(this.scroll, this.scroll + bodyRows);

		const lines: string[] = [];
		lines.push(border(th, "╭", "─", "╮", w));
		lines.push(row(th, ` ${th.fg("accent", th.bold(`Turn ${this.turn.index}`))} ${th.fg("dim", turnTitle(this.turn))}`, w));
		lines.push(row(th, "", w));

		for (const line of visible) {
			lines.push(row(th, ` ${line}`, w));
		}

		while (visible.length < bodyRows) {
			visible.push("");
			lines.push(row(th, "", w));
		}

		lines.push(row(th, "", w));
		const above = this.scroll > 0 ? `↑ ${this.scroll} ` : "";
		const below = Math.max(0, body.length - (this.scroll + bodyRows));
		const belowText = below > 0 ? `↓ ${below} ` : "";
		lines.push(row(th, ` ${th.fg("dim", `${above}${belowText}j/k scroll • Ctrl-d/u half • gg/G top/end • h back • q close`)}`, w));
		lines.push(border(th, "╰", "─", "╯", w));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private visibleBodyRows(): number {
		const rows = process.stdout.rows || 34;
		return clamp(rows - 9, 8, 34);
	}

	private getBodyLines(width: number): string[] {
		if (this.renderedBody && this.cachedBodyWidth === width) return this.renderedBody;
		const markdown = new Markdown(enhanceMermaidBlocks(buildTurnMarkdown(this.turn)), 0, 0, getMarkdownTheme());
		const rendered = markdown.render(width).map((line) => truncateToWidth(line, width, "…"));
		this.cachedBodyWidth = width;
		this.renderedBody = rendered.length > 0 ? rendered : [this.theme.fg("dim", "No content")];
		return this.renderedBody;
	}
}

const showTurnViewer = async (ctx: ExtensionContext, turn: Turn) =>
	ctx.ui.custom<"back" | "close">(
		(_tui, theme, _keybindings, done) => new TurnViewerOverlay(turn, theme, done),
		{
			overlay: true,
			overlayOptions: { width: "92%", minWidth: 70, maxHeight: "94%", anchor: "center", margin: 1 },
		},
	);

const showTurnsOverlay = async (ctx: ExtensionContext, startMostRecent = true) => {
	if (!ctx.hasUI) return;

	const turns = buildTurns(ctx.sessionManager.getBranch() as AnyEntry[]);
	if (turns.length === 0) {
		ctx.ui.notify("No turns found in current branch", "warning");
		return;
	}

	let selectedIndex = turns.length - 1;
	if (startMostRecent) {
		const action = await showTurnViewer(ctx, turns[selectedIndex]!);
		if (action === "close") return;
	}

	let keepOpen = true;
	while (keepOpen) {
		const selected = await ctx.ui.custom<Turn | undefined>(
			(_tui, theme, _keybindings, done) => new TurnListOverlay(turns, theme, done, selectedIndex),
			{
				overlay: true,
				overlayOptions: { width: "88%", minWidth: 60, maxHeight: "90%", anchor: "center", margin: 1 },
			},
		);

		if (!selected) break;
		selectedIndex = selected.index - 1;

		const action = await showTurnViewer(ctx, selected);
		keepOpen = action !== "close";
	}
};

export default function turnsExtension(pi: ExtensionAPI) {
	pi.registerCommand("turns", {
		description: "Browse previous prompts as expandable scrollable turn cards",
		handler: async (_args: string, ctx: ExtensionCommandContext) => showTurnsOverlay(ctx),
	});

	pi.registerShortcut("ctrl+x", {
		description: "Show turns overlay",
		handler: showTurnsOverlay,
	});
}
