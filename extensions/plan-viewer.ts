import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { copyToClipboard, getMarkdownTheme, type ExtensionAPI, type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Markdown, matchesKey, type OverlayHandle } from "@mariozechner/pi-tui";

type PlanningArtifact = {
	path: string;
	tag: string;
	label: string;
	order: number;
	baseline?: string;
};

type SessionEntry = {
	type?: string;
	customType?: string;
	message?: { content?: unknown };
	content?: unknown;
	data?: Record<string, unknown>;
};

type DiffLineKind = "context" | "added" | "removed" | "hunk";

type DiffLine = {
	kind: DiffLineKind;
	text: string;
};

type DiffData = {
	lines: DiffLine[];
	hunkIndexes: number[];
};

type CopySelection = {
	anchor: number;
	cursor: number;
};

type ArtifactRenderRow = {
	plain: string;
	display: string;
};

// Whitelisted stage prefixes + mandatory status suffix; loose [WORD:path] matches are not artifacts.
const ARTIFACT_TAG_RE =
	/\[((?:DISCOVERY|SPEC|DESIGN(?:-BRIEF|-DIRECTIONS|-PROTOTYPE)?|PLAN|COMPRESSED|FINAL|IMPLEMENTATION|REFACTOR(?:-SWEEP|-DISCOVERY|-BASELINE|-PLAN|-IMPLEMENTATION)?)(?:-READY|-BLOCKED|-NEEDS-DECISION|-REPORT|-PARTIAL|-COMPLETE)):([^\]]+)\]/g;
const TAGGED_ARTIFACT_ORDER_OFFSET = 1_000_000_000_000_000;
const SEARCH_DIRS = [
	".scratch/agent-workflow",
	"docs/discovery",
	"docs/specs",
	"docs/designs",
	"docs/plans",
	"docs/planning",
	"docs/reports",
];

function getAnyMessageText(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
			.map((block) => block.text)
			.join("\n");
	}
	return "";
}

function artifactLabel(tag: string, path: string): string {
	const label = tag.replace(/-(READY|BLOCKED|NEEDS-DECISION)$/i, "").toLowerCase().replace(/-/g, " ");
	return `${label}: ${path}`;
}

function isWorkflowArtifactPath(artifactPath: string): boolean {
	const normalized = artifactPath.replace(/\\/g, "/");
	return normalized.includes("/.scratch/agent-workflow/")
		|| normalized.startsWith(".scratch/agent-workflow/")
		|| SEARCH_DIRS.some((dir) => normalized.startsWith(`${dir}/`) || normalized.includes(`/${dir}/`));
}

function isMarkdownFile(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		const ext = extname(path).toLowerCase();
		return ext === ".md" || ext === ".mdx";
	} catch {
		return false;
	}
}

function boundedArtifactRoots(cwd: string): string[] {
	const roots: string[] = [];
	let entries: ReturnType<typeof readdirSync> = [];
	try {
		entries = readdirSync(cwd, { withFileTypes: true }).filter((entry) => entry.isDirectory()).slice(0, 300);
	} catch {
		return roots;
	}

	for (const entry of entries) roots.push(resolve(cwd, entry.name));

	let checkedGrandchildren = 0;
	for (const entry of entries) {
		if (checkedGrandchildren >= 1000) break;
		const parent = resolve(cwd, entry.name);
		let children: ReturnType<typeof readdirSync> = [];
		try {
			children = readdirSync(parent, { withFileTypes: true }).filter((child) => child.isDirectory()).slice(0, 100);
		} catch {
			continue;
		}
		for (const child of children) {
			if (checkedGrandchildren >= 1000) break;
			checkedGrandchildren++;
			roots.push(resolve(parent, child.name));
		}
	}
	return roots;
}

function resolveMarkdownFile(cwd: string, artifactPath: string): string | null {
	const primary = resolve(cwd, artifactPath);
	if (isMarkdownFile(primary)) return primary;

	if (isAbsolute(artifactPath) || !isWorkflowArtifactPath(artifactPath)) return null;

	for (const root of boundedArtifactRoots(cwd)) {
		const candidate = resolve(root, artifactPath);
		if (isMarkdownFile(candidate)) return candidate;
	}
	return null;
}

function displayPath(cwd: string, fullPath: string): string {
	const rel = relative(resolve(cwd), fullPath);
	return !rel.startsWith("..") && !isAbsolute(rel) ? rel : fullPath;
}

function normalizeExistingMarkdownPath(cwd: string, artifactPath: string): string | null {
	const fullPath = resolveMarkdownFile(cwd, artifactPath);
	return fullPath ? displayPath(cwd, fullPath) : null;
}

function readMarkdown(cwd: string, artifactPath: string): string | null {
	const fullPath = resolveMarkdownFile(cwd, artifactPath);
	if (!fullPath) return null;
	try {
		return readFileSync(fullPath, "utf-8");
	} catch {
		return null;
	}
}

function isExistingMarkdown(cwd: string, artifactPath: string): boolean {
	return resolveMarkdownFile(cwd, artifactPath) !== null;
}

function collectSessionBaselines(ctx: ExtensionContext): Map<string, string> {
	const baselines = new Map<string, string>();
	for (const entry of ctx.sessionManager.getEntries() as SessionEntry[]) {
		if (entry.type !== "custom") continue;
		const artifactBaselines = entry.data?.artifactBaselines;
		if (artifactBaselines && typeof artifactBaselines === "object" && !Array.isArray(artifactBaselines)) {
			for (const [artifactPath, baseline] of Object.entries(artifactBaselines as Record<string, unknown>)) {
				if (typeof baseline === "string") baselines.set(resolve(ctx.cwd, artifactPath), baseline);
			}
		}

		if (entry.customType === "filechanges:baseline") {
			const artifactPath = entry.data?.path;
			const originalContent = entry.data?.originalContent;
			const normalizedPath = typeof artifactPath === "string" && isWorkflowArtifactPath(artifactPath) ? normalizeExistingMarkdownPath(ctx.cwd, artifactPath) : null;
			if (normalizedPath && typeof originalContent === "string") {
				baselines.set(resolve(ctx.cwd, normalizedPath), originalContent);
			}
		}
	}
	return baselines;
}

function collectTaggedArtifacts(ctx: ExtensionContext, baselines: Map<string, string>): PlanningArtifact[] {
	const artifacts: PlanningArtifact[] = [];
	const entries = ctx.sessionManager.getEntries() as SessionEntry[];

	entries.forEach((entry, index) => {
		const text = entry.message ? getAnyMessageText(entry.message) : getAnyMessageText(entry);
		if (text) {
			ARTIFACT_TAG_RE.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = ARTIFACT_TAG_RE.exec(text)) !== null) {
				const tag = match[1].toUpperCase();
				const artifactPath = match[2].trim();
				const normalizedPath = artifactPath ? normalizeExistingMarkdownPath(ctx.cwd, artifactPath) : null;
				if (!normalizedPath) continue;
				artifacts.push({ path: normalizedPath, tag, label: artifactLabel(tag, normalizedPath), order: TAGGED_ARTIFACT_ORDER_OFFSET + index, baseline: baselines.get(resolve(ctx.cwd, normalizedPath)) });
			}
		}

		if (entry.type === "custom") {
			for (const key of ["planPath", "briefPath", "specPath"]) {
				const artifactPath = entry.data?.[key];
				const normalizedPath = typeof artifactPath === "string" ? normalizeExistingMarkdownPath(ctx.cwd, artifactPath) : null;
				if (!normalizedPath) continue;
				const tag = key === "planPath" ? "PLAN-READY" : key === "briefPath" ? "BRIEF-READY" : "SPEC-READY";
				artifacts.push({ path: normalizedPath, tag, label: artifactLabel(tag, normalizedPath), order: TAGGED_ARTIFACT_ORDER_OFFSET + index, baseline: baselines.get(resolve(ctx.cwd, normalizedPath)) });
			}

			const artifactPath = entry.customType === "filechanges:baseline" ? entry.data?.path : undefined;
			const normalizedPath = typeof artifactPath === "string" && isWorkflowArtifactPath(artifactPath) ? normalizeExistingMarkdownPath(ctx.cwd, artifactPath) : null;
			if (normalizedPath) {
				const tag = "SESSION-ARTIFACT";
				artifacts.push({ path: normalizedPath, tag, label: artifactLabel(tag, normalizedPath), order: TAGGED_ARTIFACT_ORDER_OFFSET + index, baseline: baselines.get(resolve(ctx.cwd, normalizedPath)) });
			}
		}
	});

	return artifacts;
}

function collectRecentMarkdownArtifacts(ctx: ExtensionContext, baselines: Map<string, string>): PlanningArtifact[] {
	const artifacts: PlanningArtifact[] = [];
	const cwd = resolve(ctx.cwd);
	let seen = 0;

	function walk(dir: string): void {
		if (seen > 1000 || !existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (seen > 1000) return;
			const fullPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			seen++;
			const ext = extname(fullPath).toLowerCase();
			if (ext !== ".md" && ext !== ".mdx") continue;
			const rel = relative(cwd, fullPath);
			if (rel.startsWith("..") || isAbsolute(rel)) continue;
			const mtime = statSync(fullPath).mtimeMs;
			artifacts.push({ path: rel, tag: "RECENT-MARKDOWN", label: `recent artifact: ${rel}`, order: mtime, baseline: baselines.get(fullPath) });
		}
	}

	for (const dir of SEARCH_DIRS) walk(resolve(ctx.cwd, dir));
	return artifacts;
}

function collectArtifacts(ctx: ExtensionContext): PlanningArtifact[] {
	const baselines = collectSessionBaselines(ctx);
	const artifacts = [...collectTaggedArtifacts(ctx, baselines), ...collectRecentMarkdownArtifacts(ctx, baselines)];
	const latestByPath = new Map<string, PlanningArtifact>();
	for (const artifact of artifacts) {
		const key = resolve(ctx.cwd, artifact.path);
		const existing = latestByPath.get(key);
		if (!existing || artifact.order >= existing.order) latestByPath.set(key, artifact);
	}
	return [...latestByPath.values()].sort((a, b) => b.order - a.order);
}

async function openArtifactInBrowser(ctx: ExtensionContext, artifact: PlanningArtifact, markdown: string): Promise<void> {
	try {
		const preview = await import("pi-markdown-preview") as { openPreviewInBrowser?: (...args: unknown[]) => Promise<void> };
		if (!preview.openPreviewInBrowser) {
			ctx.ui.notify("pi-markdown-preview is installed but did not expose openPreviewInBrowser.", "warning");
			return;
		}
		const artifactFile = resolveMarkdownFile(ctx.cwd, artifact.path);
		await preview.openPreviewInBrowser(ctx, markdown, artifactFile ? dirname(artifactFile) : ctx.cwd, false);
		ctx.ui.notify("Opened artifact preview in browser.", "info");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const installHint = message.includes("pi-markdown-preview") ? " Install with: pi install npm:pi-markdown-preview" : "";
		ctx.ui.notify(`Browser preview failed: ${message}.${installHint}`, "error");
	}
}

function stripAnsi(value: string): string {
	return value
		.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function plainVisibleWidth(value: string): number {
	return Array.from(stripAnsi(value)).length;
}

function truncatePlain(value: string, width: number): string {
	if (plainVisibleWidth(value) <= width) return value;
	const limit = Math.max(0, width - 1);
	let visible = 0;
	let output = "";
	for (let index = 0; index < value.length;) {
		const ansi = /^\x1b\[[0-9;]*m/.exec(value.slice(index));
		if (ansi) {
			output += ansi[0];
			index += ansi[0].length;
			continue;
		}
		if (visible >= limit) break;
		const codePoint = value.codePointAt(index);
		if (codePoint === undefined) break;
		const char = String.fromCodePoint(codePoint);
		output += char;
		visible++;
		index += char.length;
	}
	return output + "…";
}

function wrapPlain(value: string, width: number): string[] {
	if (width <= 0) return [""];
	const lines: string[] = [];
	for (const rawLine of value.split(/\r?\n/)) {
		const chars = Array.from(rawLine || " ");
		if (chars.length === 0) {
			lines.push("");
			continue;
		}
		for (let index = 0; index < chars.length; index += width) lines.push(chars.slice(index, index + width).join(""));
	}
	return lines;
}

function splitLines(value: string): string[] {
	return value.length === 0 ? [] : value.replace(/\r\n/g, "\n").split("\n");
}

function buildLineDiff(oldText: string, newText: string): DiffLine[] {
	const oldLines = splitLines(oldText);
	const newLines = splitLines(newText);
	const table = Array.from({ length: oldLines.length + 1 }, () => Array<number>(newLines.length + 1).fill(0));
	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
			table[oldIndex]![newIndex] = oldLines[oldIndex] === newLines[newIndex]
				? table[oldIndex + 1]![newIndex + 1]! + 1
				: Math.max(table[oldIndex + 1]![newIndex]!, table[oldIndex]![newIndex + 1]!);
		}
	}

	const lines: DiffLine[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldLines.length && newIndex < newLines.length) {
		if (oldLines[oldIndex] === newLines[newIndex]) {
			lines.push({ kind: "context", text: ` ${oldLines[oldIndex]}` });
			oldIndex++;
			newIndex++;
		} else if (table[oldIndex + 1]![newIndex]! >= table[oldIndex]![newIndex + 1]!) {
			lines.push({ kind: "removed", text: `-${oldLines[oldIndex]}` });
			oldIndex++;
		} else {
			lines.push({ kind: "added", text: `+${newLines[newIndex]}` });
			newIndex++;
		}
	}
	while (oldIndex < oldLines.length) lines.push({ kind: "removed", text: `-${oldLines[oldIndex++]}` });
	while (newIndex < newLines.length) lines.push({ kind: "added", text: `+${newLines[newIndex++]}` });
	return lines;
}

function buildUnifiedDiff(oldText: string, newText: string): DiffData | undefined {
	if (oldText === newText) return undefined;
	const raw = buildLineDiff(oldText, newText);
	const changed = raw.map((line, index) => line.kind === "added" || line.kind === "removed" ? index : -1).filter((index) => index >= 0);
	if (changed.length === 0) return undefined;

	const ranges: Array<{ start: number; end: number }> = [];
	for (const index of changed) {
		const start = Math.max(0, index - 3);
		const end = Math.min(raw.length - 1, index + 3);
		const last = ranges[ranges.length - 1];
		if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
		else ranges.push({ start, end });
	}

	const lines: DiffLine[] = [];
	const hunkIndexes: number[] = [];
	for (const range of ranges) {
		hunkIndexes.push(lines.length);
		lines.push({ kind: "hunk", text: `@@ lines ${range.start + 1}-${range.end + 1} @@` });
		lines.push(...raw.slice(range.start, range.end + 1));
	}
	return { lines, hunkIndexes };
}

class PlanArtifactViewer {
	private scroll = 0;
	private mode: "rendered" | "raw" | "diff" = "rendered";
	private activeHunk = 0;
	private focused = false;
	private copySelection?: CopySelection;
	private copyStatus?: string;
	private lastContentWidth = 80;
	private renderedCache?: { width: number; rows: ArtifactRenderRow[] };
	private readonly diff?: DiffData;

	constructor(
		private theme: Theme,
		private artifact: PlanningArtifact,
		private markdown: string,
		private artifactCount: number,
		private releaseFocus: () => void,
		private done: (result: "close" | "history") => void,
		private openBrowserPreview: () => void,
	) {
		this.diff = artifact.baseline === undefined ? undefined : buildUnifiedDiff(artifact.baseline, markdown);
	}

	handleInput(data: string): void {
		const rows = this.sourceRows(this.lastContentWidth);
		this.clampScroll(rows.length);

		if (this.copySelection) {
			if (matchesKey(data, "up")) {
				this.moveCopyCursor(-1, rows.length);
				return;
			}
			if (matchesKey(data, "down")) {
				this.moveCopyCursor(1, rows.length);
				return;
			}
			if (data === "Y") {
				this.yankCopyRows(rows);
				return;
			}
			if (matchesKey(data, "escape") || data === "q" || data === "Q") {
				this.copySelection = undefined;
				this.copyStatus = undefined;
				return;
			}
			return;
		}

		if (data === "v") {
			if (rows.length === 0) {
				this.copyStatus = "No lines to copy";
				return;
			}
			const start = Math.max(0, Math.min(this.scroll, rows.length - 1));
			this.copySelection = { anchor: start, cursor: start };
			this.copyStatus = undefined;
			return;
		}
		if (matchesKey(data, "ctrl+r") || data === "f") {
			this.releaseFocus();
			return;
		}
		if (data === "m" || data === "M") {
			this.mode = this.mode === "rendered" ? "raw" : "rendered";
			this.scroll = 0;
			this.copyStatus = undefined;
			return;
		}
		if (data === "b" || data === "B") {
			this.copyStatus = "Opening browser preview…";
			this.openBrowserPreview();
			return;
		}
		if (data === "r" || data === "R") {
			this.renderedCache = undefined;
			this.copyStatus = "Refreshed rendered view";
			return;
		}
		if (matchesKey(data, "escape") || data === "q" || data === "Q") {
			this.done("close");
			return;
		}
		if (data === "h" || data === "H") {
			this.done("history");
			return;
		}
		if (data === "d" && this.diff) {
			this.mode = this.mode === "diff" ? "rendered" : "diff";
			this.scroll = 0;
			this.copyStatus = undefined;
			return;
		}
		if (this.mode === "diff" && this.diff && matchesKey(data, "right")) {
			this.jumpToHunk(1);
			return;
		}
		if (this.mode === "diff" && this.diff && matchesKey(data, "left")) {
			this.jumpToHunk(-1);
			return;
		}
		if (matchesKey(data, "up")) this.scroll -= 1;
		else if (matchesKey(data, "down")) this.scroll += 1;
		else if (matchesKey(data, "pageUp")) this.scroll -= 10;
		else if (matchesKey(data, "pageDown")) this.scroll += 10;
		else if (matchesKey(data, "home")) this.scroll = 0;
		else if (matchesKey(data, "end")) this.scroll = Number.MAX_SAFE_INTEGER;
	}

	setViewerFocus(focused: boolean): void {
		this.focused = focused;
		this.invalidate();
	}

	private bodyHeight(): number {
		const rows = process.stdout.rows || 34;
		const overlayRows = Math.max(14, Math.floor(rows * 0.6));
		return Math.max(8, overlayRows - 8);
	}

	private jumpToHunk(delta: number): void {
		if (!this.diff || this.diff.hunkIndexes.length === 0) return;
		this.activeHunk = Math.max(0, Math.min(this.activeHunk + delta, this.diff.hunkIndexes.length - 1));
		this.scroll = this.diff.hunkIndexes[this.activeHunk] ?? 0;
	}

	private clampScroll(rowCount: number): void {
		const maxScroll = Math.max(0, rowCount - this.bodyHeight());
		this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
	}

	private copyRange(): [number, number] | undefined {
		if (!this.copySelection) return undefined;
		return [Math.min(this.copySelection.anchor, this.copySelection.cursor), Math.max(this.copySelection.anchor, this.copySelection.cursor)];
	}

	private isCopySelected(index: number): boolean {
		const range = this.copyRange();
		return !!range && index >= range[0] && index <= range[1];
	}

	private moveCopyCursor(delta: number, rowCount: number): void {
		if (!this.copySelection || rowCount === 0) return;
		this.copySelection.cursor = Math.max(0, Math.min(this.copySelection.cursor + delta, rowCount - 1));
		if (this.copySelection.cursor < this.scroll) this.scroll = this.copySelection.cursor;
		else if (this.copySelection.cursor >= this.scroll + this.bodyHeight()) this.scroll = this.copySelection.cursor - this.bodyHeight() + 1;
		this.clampScroll(rowCount);
	}

	private yankCopyRows(rows: ArtifactRenderRow[]): void {
		const range = this.copyRange();
		if (!range) return;
		const selected = rows.slice(range[0], range[1] + 1).map((row) => row.plain);
		void copyToClipboard(selected.join("\n"));
		this.copySelection = undefined;
		this.copyStatus = `Copied ${selected.length} line(s)`;
	}

	render(width: number): string[] {
		const outerWidth = Math.max(40, width);
		const innerWidth = Math.max(10, outerWidth - 2);
		const bodyHeight = this.bodyHeight();
		const contentWidth = Math.max(10, innerWidth - 2);
		this.lastContentWidth = contentWidth;
		const rendered = this.sourceRows(contentWidth);
		this.clampScroll(rendered.length);

		const pad = (value: string, targetWidth: number): string => {
			const truncated = truncatePlain(value, targetWidth);
			return truncated + " ".repeat(Math.max(0, targetWidth - plainVisibleWidth(truncated)));
		};
		const row = (value = "", selected = false): string => {
			const content = pad(` ${value}`, innerWidth);
			return this.theme.fg("border", "│") + (selected ? `\x1b[7m${content}\x1b[27m` : content) + this.theme.fg("border", "│");
		};
		const historyHint = this.artifactCount > 1 ? ` • h history (${this.artifactCount})` : "";
		const focusHint = this.focused ? "pane focused" : "typing focused";
		const title = `${this.mode === "diff" ? "Artifact Diff" : this.mode === "raw" ? "Artifact Raw" : "Artifact Rendered"} (${focusHint})`;
		const focusKeys = "Ctrl-r/f";
		const help = this.copySelection
			? "COPY • ↑↓ select • Y yank • Esc/q cancel"
			: this.copyStatus ?? (this.diff
				? `${this.focused ? `${focusKeys} typing focus` : `${focusKeys} focus pane`} • v copy • ↑↓ scroll • m raw/rendered • b browser • r refresh • ←/→ hunks • d diff • h history • Esc/q close${historyHint}`
				: `${this.focused ? `${focusKeys} typing focus` : `${focusKeys} focus pane`} • v copy • ↑↓/PgUp/PgDn scroll • m raw/rendered • b browser • r refresh • h history • Esc/q close • no diff snapshot${historyHint}`);

		const lines: string[] = [];
		lines.push(this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
		lines.push(row(this.theme.fg(this.focused ? "success" : "warning", this.theme.bold(title))));
		lines.push(row(this.theme.fg("muted", this.artifact.label)));
		lines.push(row(this.theme.fg("dim", help)));
		lines.push(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`));

		const visible = rendered.slice(this.scroll, this.scroll + bodyHeight);
		for (let index = 0; index < bodyHeight; index++) {
			const sourceIndex = this.scroll + index;
			const visibleRow = visible[index];
			const display = visibleRow?.display ?? "";
			lines.push(row(display, !!visibleRow && this.isCopySelected(sourceIndex)));
		}

		const hunkInfo = this.mode === "diff" && this.diff
			? ` • hunk ${Math.min(this.activeHunk + 1, this.diff.hunkIndexes.length)}/${this.diff.hunkIndexes.length}`
			: "";
		lines.push(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`));
		const copyInfo = this.copySelection ? ` • copy ${Math.abs(this.copySelection.cursor - this.copySelection.anchor) + 1} line(s)` : "";
		lines.push(row(this.theme.fg("dim", `${this.mode} • line ${Math.min(this.scroll + 1, rendered.length || 1)}-${Math.min(this.scroll + bodyHeight, rendered.length)} of ${rendered.length || 1}${hunkInfo}${copyInfo}`)));
		lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	private rawLines(): DiffLine[] {
		return wrapPlain(this.markdown, Number.MAX_SAFE_INTEGER).map((text) => ({ kind: "context", text }));
	}

	private renderedRows(width: number): ArtifactRenderRow[] {
		if (this.renderedCache?.width === width) return this.renderedCache.rows;
		const rendered = new Markdown(this.markdown, 0, 0, getMarkdownTheme()).render(width);
		const rows = rendered.map((display) => ({ plain: stripAnsi(display).trimEnd(), display }));
		this.renderedCache = { width, rows };
		return rows;
	}

	private sourceRows(width: number): ArtifactRenderRow[] {
		if (this.mode === "rendered") return this.renderedRows(width);
		const sourceLines = this.mode === "diff" && this.diff ? this.diff.lines : this.rawLines();
		return sourceLines.flatMap((line) => this.renderSourceLine(line, width));
	}

	private renderSourceLine(line: DiffLine, width: number): ArtifactRenderRow[] {
		const styled = (value: string): string => {
			if (line.kind === "added") return this.theme.fg("success", value);
			if (line.kind === "removed") return this.theme.fg("error", value);
			if (line.kind === "hunk") return this.theme.fg("accent", value);
			return value;
		};
		return wrapPlain(line.text, width).map((plain) => ({ plain, display: styled(plain) }));
	}

	invalidate(): void {
		this.renderedCache = undefined;
	}
}

type ActiveArtifactOverlay = {
	handle: OverlayHandle;
	viewer?: PlanArtifactViewer;
};

let activeArtifactOverlay: ActiveArtifactOverlay | undefined;

function toggleActiveArtifactFocus(): void {
	const active = activeArtifactOverlay;
	if (!active?.handle) return;
	if (active.handle.isFocused()) {
		active.viewer?.setViewerFocus(false);
		active.handle.unfocus();
		return;
	}
	active.viewer?.setViewerFocus(true);
	active.handle.focus();
}

const artifactOverlayOptions = {
	width: "100%",
	maxHeight: "65%",
	anchor: "top-center" as const,
	margin: { top: 1, right: 1, bottom: 8, left: 1 },
	nonCapturing: true,
};

export default function planViewerExtension(pi: ExtensionAPI): void {
	async function openArtifact(ctx: ExtensionContext, initialArtifact: PlanningArtifact, artifacts: PlanningArtifact[]): Promise<void> {
		let current = initialArtifact;
		while (true) {
			const content = readMarkdown(ctx.cwd, current.path);
			if (!content) {
				ctx.ui.notify(`Markdown artifact missing: ${current.path}`, "warning");
				return;
			}

			let overlayHandle: OverlayHandle | undefined;
			let viewer: PlanArtifactViewer | undefined;
			const result = await ctx.ui.custom<"close" | "history">((_tui, theme, _keybindings, done) => {
				const releaseFocus = toggleActiveArtifactFocus;
				const close = (result: "close" | "history") => {
					overlayHandle?.hide();
					done(result);
				};
				viewer = new PlanArtifactViewer(theme, current, content, artifacts.length, releaseFocus, close, () => {
					void openArtifactInBrowser(ctx, current, content);
				});
				return viewer;
			}, {
				overlay: true,
				overlayOptions: artifactOverlayOptions,
				onHandle: (handle) => {
					overlayHandle = handle;
					activeArtifactOverlay = { handle, viewer };
					viewer?.setViewerFocus(true);
					handle.focus();
				},
			});
			if (activeArtifactOverlay?.viewer === viewer) activeArtifactOverlay = undefined;

			if (result !== "history") return;
			if (artifacts.length <= 1) continue;

			const labels = artifacts.map((artifact, index) => `${index === 0 ? "latest — " : ""}${artifact.label}`);
			const choice = await ctx.ui.select("Workflow artifacts (latest first)", labels);
			if (!choice) return;
			const selectedIndex = labels.indexOf(choice);
			if (selectedIndex >= 0) current = artifacts[selectedIndex];
		}
	}

	async function openCurrentPlan(ctx: ExtensionContext): Promise<void> {
		const artifacts = collectArtifacts(ctx);
		if (artifacts.length === 0) {
			ctx.ui.notify("No Markdown workflow artifact found in this session, .scratch/agent-workflow, or docs artifact folders.", "warning");
			return;
		}
		await openArtifact(ctx, artifacts[0], artifacts);
	}

	async function artifactView(args: string, ctx: ExtensionContext): Promise<void> {
		const requestedPath = args.trim();
		if (!requestedPath) {
			await openCurrentPlan(ctx);
			return;
		}

		const normalizedPath = normalizeExistingMarkdownPath(ctx.cwd, requestedPath);
		if (!normalizedPath) {
			ctx.ui.notify(`Markdown artifact missing: ${requestedPath}`, "warning");
			return;
		}

		const artifact: PlanningArtifact = {
			path: normalizedPath,
			tag: "REQUESTED-ARTIFACT",
			label: artifactLabel("REQUESTED-ARTIFACT", normalizedPath),
			order: Date.now(),
		};
		await openArtifact(ctx, artifact, [artifact, ...collectArtifacts(ctx)]);
	}

	pi.registerCommand("artifact-view", {
		description: "Open latest Markdown workflow artifact viewer, or /artifact-view <path>",
		handler: artifactView,
	});

	const openOrFocusArtifactView = (ctx: ExtensionContext) => {
		if (activeArtifactOverlay?.handle && !activeArtifactOverlay.handle.isHidden()) {
			toggleActiveArtifactFocus();
			return;
		}
		void artifactView("", ctx);
	};

	pi.registerShortcut("ctrl+r", {
		description: "Show/focus /artifact-view",
		handler: openOrFocusArtifactView,
	});
}
