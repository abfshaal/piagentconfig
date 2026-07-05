import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { copyToClipboard, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Markdown, matchesKey, type OverlayHandle, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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

type FocusAwareOverlay = {
	setOverlayFocused(focused: boolean): void;
};

type CopySelection = {
	anchor: number;
	cursor: number;
};

type TurnListRow = {
	turnIndex: number;
	plain: string;
	display: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const padRight = (text: string, width: number) => {
	const visible = visibleWidth(text);
	return text + " ".repeat(Math.max(0, width - visible));
};

const stripAnsiCodes = (value: string) =>
	value.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

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

class TurnListOverlay implements FocusAwareOverlay {
	private selected = 0;
	private scroll = 0;
	private pendingG = false;
	private focused = false;
	private copySelection?: CopySelection;
	private copyStatus?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private turns: Turn[],
		private theme: Theme,
		private done: (turn: Turn | undefined) => void,
		private toggleFocus: () => void,
		initialSelected = 0,
	) {
		this.selected = clamp(initialSelected, 0, Math.max(0, turns.length - 1));
		this.ensureVisible();
	}

	setOverlayFocused(focused: boolean): void {
		this.focused = focused;
		this.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+x")) {
			this.toggleFocus();
			return;
		}
		if (this.copySelection) {
			if (matchesKey(data, "escape") || data === "q") {
				this.copySelection = undefined;
				this.copyStatus = undefined;
				this.invalidate();
				return;
			}
			if (data === "Y") {
				this.copySelectedRows();
				return;
			}
			if (matchesKey(data, "up")) {
				this.moveCopyCursor(-1);
				return;
			}
			if (matchesKey(data, "down")) {
				this.moveCopyCursor(1);
				return;
			}
			return;
		}
		if (data === "v") {
			this.startCopy();
			return;
		}
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
		const focusLabel = this.focused ? "focused" : "typing focus";
		lines.push(row(th, ` ${th.fg("accent", th.bold("Turns"))} ${th.fg("dim", `${this.turns.length} prompts • ${focusLabel}`)}`, w));
		lines.push(row(th, "", w));

		if (this.turns.length === 0) {
			lines.push(row(th, ` ${th.fg("warning", "No user prompts in current branch yet.")}`, w));
		} else {
			const rows = this.buildListRows(Math.max(1, w - 2));
			const visible = rows.slice(this.scroll, this.scroll + bodyRows);
			for (const listRow of visible) {
				const selected = this.isCopySelected(listRow.turnIndex);
				const content = selected ? `\x1b[7m${listRow.display}\x1b[27m` : listRow.display;
				lines.push(row(th, content, w));
			}
		}

		lines.push(row(th, "", w));
		const moreTop = this.scroll > 0 ? `↑ ${this.scroll} ` : "";
		const below = Math.max(0, this.turns.length - (this.scroll + bodyRows));
		const moreBottom = below > 0 ? `↓ ${below} ` : "";
		const status = this.copySelection
			? "COPY • ↑↓ select • Y yank • Esc/q cancel"
			: (this.copyStatus ?? "Ctrl-x focus/type • j/k move • Ctrl-d/u half • l open • h/q close");
		lines.push(row(th, ` ${th.fg("dim", `${moreTop}${moreBottom}${status}`)}`, w));
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
		const overlayRows = Math.max(12, Math.floor(rows * 0.6));
		return Math.max(6, overlayRows - 6);
	}

	private ensureVisible(): void {
		const rows = this.visibleRows();
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + rows) this.scroll = this.selected - rows + 1;
		this.scroll = clamp(this.scroll, 0, Math.max(0, this.turns.length - rows));
	}

	private buildListRows(width: number): TurnListRow[] {
		return this.turns.map((turn) => {
			const selected = turn.index - 1 === this.selected;
			const prefix = selected ? this.theme.fg("accent", "▶") : " ";
			const index = String(turn.index).padStart(2, "0");
			const toolCount = turn.toolCalls.length;
			const answerPlain = turn.assistantText.trim() ? "✓" : "…";
			const toolsPlain = toolCount ? `${toolCount} tools` : "no tools";
			const statusPlain = `${answerPlain} ${toolsPlain}`;
			const plainPrefix = `Turn ${index}: `;
			const plainSuffix = ` · ${statusPlain}`;
			const titleWidth = Math.max(1, width - visibleWidth(plainPrefix) - visibleWidth(plainSuffix));
			const title = truncateToWidth(turnTitle(turn), titleWidth, "…");
			const answer = turn.assistantText.trim() ? this.theme.fg("success", "✓") : this.theme.fg("dim", "…");
			const meta = `${answer} ${toolCount ? this.theme.fg("muted", `${toolCount} tools`) : this.theme.fg("dim", "no tools")}`;
			const label = selected ? this.theme.fg("accent", title) : this.theme.fg("text", title);
			const plain = truncateToWidth(`${plainPrefix}${title}${plainSuffix}`, width, "…");
			return {
				turnIndex: turn.index - 1,
				plain,
				display: ` ${prefix} ${index} ${label} ${this.theme.fg("dim", "·")} ${meta}`,
			};
		});
	}

	private startCopy(): void {
		if (this.turns.length === 0) {
			this.copyStatus = "No turn rows to copy";
			this.invalidate();
			return;
		}
		this.copySelection = { anchor: this.selected, cursor: this.selected };
		this.copyStatus = undefined;
		this.ensureVisible();
		this.invalidate();
	}

	private moveCopyCursor(delta: number): void {
		if (!this.copySelection || this.turns.length === 0) return;
		this.copySelection.cursor = clamp(this.copySelection.cursor + delta, 0, this.turns.length - 1);
		this.selected = this.copySelection.cursor;
		this.ensureVisible();
		this.invalidate();
	}

	private copySelectedRows(): void {
		if (!this.copySelection) return;
		const [start, end] = this.copyRange();
		const width = Math.max(1, Math.max(40, this.cachedWidth ?? 80) - 2);
		const rows = this.buildListRows(width).slice(start, end + 1);
		void copyToClipboard(rows.map((listRow) => listRow.plain).join("\n"));
		this.copySelection = undefined;
		this.copyStatus = `Copied ${rows.length} line(s)`;
		this.invalidate();
	}

	private copyRange(): [number, number] {
		if (!this.copySelection) return [0, -1];
		return [Math.min(this.copySelection.anchor, this.copySelection.cursor), Math.max(this.copySelection.anchor, this.copySelection.cursor)];
	}

	private isCopySelected(index: number): boolean {
		if (!this.copySelection) return false;
		const [start, end] = this.copyRange();
		return index >= start && index <= end;
	}
}

class TurnViewerOverlay implements FocusAwareOverlay {
	private scroll = 0;
	private pendingG = false;
	private focused = false;
	private copySelection?: CopySelection;
	private copyStatus?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private cachedBodyWidth?: number;
	private renderedBody?: string[];
	private plainBody?: string[];
	private bodyHasContent = true;

	constructor(
		private turn: Turn,
		private theme: Theme,
		private done: (action: "back" | "close") => void,
		private toggleFocus: () => void,
	) {}

	setOverlayFocused(focused: boolean): void {
		this.focused = focused;
		this.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+x")) {
			this.toggleFocus();
			return;
		}
		if (this.copySelection) {
			if (matchesKey(data, "escape") || data === "q") {
				this.copySelection = undefined;
				this.copyStatus = undefined;
				this.invalidate();
				return;
			}
			if (data === "Y") {
				this.copySelectedRows();
				return;
			}
			if (matchesKey(data, "up")) {
				this.moveCopyCursor(-1);
				return;
			}
			if (matchesKey(data, "down")) {
				this.moveCopyCursor(1);
				return;
			}
			return;
		}
		if (data === "v") {
			this.startCopy();
			return;
		}
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
		const focusLabel = this.focused ? "pane focused" : "typing focused";
		lines.push(row(th, ` ${th.fg(this.focused ? "success" : "warning", th.bold(`Assistant Response (${focusLabel})`))}`, w));
		lines.push(row(th, ` ${th.fg("muted", `turn ${this.turn.index}: ${turnTitle(this.turn)}`)}`, w));
		const above = this.scroll > 0 ? `↑ ${this.scroll} ` : "";
		const below = Math.max(0, body.length - (this.scroll + bodyRows));
		const belowText = below > 0 ? `↓ ${below} ` : "";
		const help = this.copySelection
			? "COPY • ↑↓ select • Y yank • Esc/q cancel"
			: (this.copyStatus ?? "Ctrl-x focus/type • v copy • ↑↓/j/k scroll • PgUp/PgDn/Ctrl-d/u page • h back • q close");
		lines.push(row(th, ` ${th.fg("dim", `${above}${belowText}${help}`)}`, w));
		lines.push(border(th, "├", "─", "┤", w));

		for (let index = 0; index < bodyRows; index++) {
			const bodyIndex = this.scroll + index;
			const line = visible[index] ?? "";
			const content = this.isCopySelected(bodyIndex) ? `\x1b[7m ${line}\x1b[27m` : ` ${line}`;
			lines.push(row(th, content, w));
		}

		lines.push(border(th, "├", "─", "┤", w));
		const copyInfo = this.copySelection ? ` • copy ${Math.abs(this.copySelection.cursor - this.copySelection.anchor) + 1} line(s)` : "";
		lines.push(row(th, ` ${th.fg("dim", `rendered markdown • line ${Math.min(this.scroll + 1, body.length || 1)}-${Math.min(this.scroll + bodyRows, body.length)} of ${body.length || 1}${copyInfo}`)}`, w));
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
		const overlayRows = Math.max(14, Math.floor(rows * 0.6));
		return Math.max(8, overlayRows - 8);
	}

	private getBodyLines(width: number): string[] {
		if (this.renderedBody && this.cachedBodyWidth === width) return this.renderedBody;
		const markdown = new Markdown(enhanceMermaidBlocks(buildTurnMarkdown(this.turn)), 0, 0, getMarkdownTheme());
		const rendered = markdown.render(width).map((line) => truncateToWidth(line, width, "…"));
		this.cachedBodyWidth = width;
		this.bodyHasContent = rendered.length > 0;
		this.renderedBody = this.bodyHasContent ? rendered : [this.theme.fg("dim", "No content")];
		this.plainBody = this.bodyHasContent ? rendered.map((line) => stripAnsiCodes(line).replace(/[ \t]+$/g, "")) : [];
		return this.renderedBody;
	}

	private getPlainBodyLines(width: number): string[] {
		if (!this.plainBody || this.cachedBodyWidth !== width) this.getBodyLines(width);
		return this.plainBody ?? [];
	}

	private startCopy(): void {
		const width = this.cachedBodyWidth ?? 80;
		const plain = this.getPlainBodyLines(width);
		if (!this.bodyHasContent || plain.length === 0) {
			this.copyStatus = "No content rows to copy";
			this.invalidate();
			return;
		}
		const maxScroll = Math.max(0, plain.length - this.visibleBodyRows());
		this.scroll = clamp(this.scroll, 0, maxScroll);
		this.copySelection = { anchor: this.scroll, cursor: this.scroll };
		this.copyStatus = undefined;
		this.invalidate();
	}

	private moveCopyCursor(delta: number): void {
		if (!this.copySelection) return;
		const width = this.cachedBodyWidth ?? 80;
		const body = this.getPlainBodyLines(width);
		if (body.length === 0) return;
		const page = this.visibleBodyRows();
		this.copySelection.cursor = clamp(this.copySelection.cursor + delta, 0, body.length - 1);
		if (this.copySelection.cursor < this.scroll) this.scroll = this.copySelection.cursor;
		if (this.copySelection.cursor >= this.scroll + page) this.scroll = this.copySelection.cursor - page + 1;
		this.scroll = clamp(this.scroll, 0, Math.max(0, body.length - page));
		this.invalidate();
	}

	private copySelectedRows(): void {
		if (!this.copySelection) return;
		const width = this.cachedBodyWidth ?? 80;
		const body = this.getPlainBodyLines(width);
		const [start, end] = this.copyRange();
		const rows = body.slice(start, end + 1);
		void copyToClipboard(rows.join("\n"));
		this.copySelection = undefined;
		this.copyStatus = `Copied ${rows.length} line(s)`;
		this.invalidate();
	}

	private copyRange(): [number, number] {
		if (!this.copySelection) return [0, -1];
		return [Math.min(this.copySelection.anchor, this.copySelection.cursor), Math.max(this.copySelection.anchor, this.copySelection.cursor)];
	}

	private isCopySelected(index: number): boolean {
		if (!this.copySelection) return false;
		const [start, end] = this.copyRange();
		return index >= start && index <= end;
	}
}

let activeTurnsOverlay: { handle?: OverlayHandle; component?: FocusAwareOverlay } | undefined;

const toggleActiveTurnsFocus = () => {
	const active = activeTurnsOverlay;
	if (!active?.handle) return;
	if (active.handle.isFocused()) {
		active.component?.setOverlayFocused(false);
		active.handle.unfocus();
		return;
	}
	active.component?.setOverlayFocused(true);
	active.handle.focus();
};

const turnOverlayOptions = {
	width: "100%",
	maxHeight: "65%",
	anchor: "top-center" as const,
	margin: { top: 1, right: 1, bottom: 8, left: 1 },
	nonCapturing: true,
};

const showTurnViewer = async (ctx: ExtensionContext, turn: Turn) => {
	let component: TurnViewerOverlay | undefined;
	const result = await ctx.ui.custom<"back" | "close">(
		(_tui, theme, _keybindings, done) => {
			component = new TurnViewerOverlay(turn, theme, done, toggleActiveTurnsFocus);
			return component;
		},
		{
			overlay: true,
			overlayOptions: turnOverlayOptions,
			onHandle: (handle) => {
				activeTurnsOverlay = { handle, component };
				component?.setOverlayFocused(true);
				handle.focus();
			},
		},
	);
	if (activeTurnsOverlay?.component === component) activeTurnsOverlay = undefined;
	return result;
};

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
		let component: TurnListOverlay | undefined;
		const selected = await ctx.ui.custom<Turn | undefined>(
			(_tui, theme, _keybindings, done) => {
				component = new TurnListOverlay(turns, theme, done, toggleActiveTurnsFocus, selectedIndex);
				return component;
			},
			{
				overlay: true,
				overlayOptions: turnOverlayOptions,
				onHandle: (handle) => {
					activeTurnsOverlay = { handle, component };
					component?.setOverlayFocused(true);
					handle.focus();
				},
			},
		);
		if (activeTurnsOverlay?.component === component) activeTurnsOverlay = undefined;

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
		description: "Show/focus turns overlay",
		handler: (ctx) => {
			if (activeTurnsOverlay?.handle && !activeTurnsOverlay.handle.isHidden()) {
				toggleActiveTurnsFocus();
				return;
			}
			void showTurnsOverlay(ctx);
		},
	});
}
