import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

type Theme = ExtensionContext["ui"]["theme"];

type TaskStatus = "pending" | "running" | "reviewing" | "fixing" | "committing" | "done" | "blocked" | "skipped";

type StageTask = {
	id: string;
	title: string;
	status: TaskStatus;
	level?: number;
	parentId?: string;
	note?: string;
};

type StageProgressState = {
	active: boolean;
	planPath?: string;
	feature?: string;
	phase?: string;
	tasks: StageTask[];
	currentTaskId?: string;
	currentAgent?: string;
	currentActivity?: string;
	message?: string;
	startedAt?: number;
	updatedAt?: number;
	completedAt?: number;
};

type StageProgressAction = "start" | "set_task" | "update" | "complete_task" | "block_task" | "finish" | "clear" | "list";

const STATE_TYPE = "staged-progress";
const WIDGET_KEY = "staged-progress";
const TOOL_NAME = "stage_progress";

const TaskStatusSchema = Type.Union([
	Type.Literal("pending"),
	Type.Literal("running"),
	Type.Literal("reviewing"),
	Type.Literal("fixing"),
	Type.Literal("committing"),
	Type.Literal("done"),
	Type.Literal("blocked"),
	Type.Literal("skipped"),
]);

const TaskSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Stable task id, e.g. T1 or T1.2" })),
	title: Type.String({ description: "Task or subtask title shown in progress UI" }),
	status: Type.Optional(TaskStatusSchema),
	level: Type.Optional(Type.Number({ description: "Indent level. 0 for task, 1+ for subtasks." })),
	parentId: Type.Optional(Type.String({ description: "Parent task id for subtasks" })),
	note: Type.Optional(Type.String({ description: "Short optional note shown beside the task" })),
});

const StageProgressParams = Type.Object({
	action: Type.Union([
		Type.Literal("start"),
		Type.Literal("set_task"),
		Type.Literal("update"),
		Type.Literal("complete_task"),
		Type.Literal("block_task"),
		Type.Literal("finish"),
		Type.Literal("clear"),
		Type.Literal("list"),
	], { description: "Progress action" }),
	planPath: Type.Optional(Type.String({ description: "Plan artifact path. Used to parse tasks if tasks omitted." })),
	feature: Type.Optional(Type.String({ description: "Feature name shown in header" })),
	phase: Type.Optional(Type.String({ description: "Workflow phase label, e.g. implementation" })),
	tasks: Type.Optional(Type.Array(TaskSchema, { description: "Ordered tasks/subtasks for the implementation queue" })),
	taskId: Type.Optional(Type.String({ description: "Task id to update. Defaults to current task when omitted." })),
	taskIndex: Type.Optional(Type.Number({ description: "1-based task index to update when taskId is omitted" })),
	taskTitle: Type.Optional(Type.String({ description: "Task title/text to match when id/index omitted" })),
	status: Type.Optional(TaskStatusSchema),
	agent: Type.Optional(Type.String({ description: "Current subagent, e.g. plan-implementer" })),
	activity: Type.Optional(Type.String({ description: "Current activity/tool summary" })),
	message: Type.Optional(Type.String({ description: "Short progress note" })),
	note: Type.Optional(Type.String({ description: "Short note to attach to the task" })),
});

function emptyState(): StageProgressState {
	return { active: false, tasks: [] };
}

function normalizeText(value: string): string {
	return value.toLowerCase().replace(/[`*_()[\]#>:.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function shortPath(cwd: string, value: string | undefined): string | undefined {
	if (!value) return undefined;
	const full = resolveMaybePath(cwd, value);
	const rel = relative(cwd, full);
	if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
	return value.replace(process.env.HOME || "", "~");
}

function resolveMaybePath(cwd: string, value: string): string {
	if (value.startsWith("~/")) return resolve(process.env.HOME || cwd, value.slice(2));
	return isAbsolute(value) ? value : resolve(cwd, value);
}

function safeReadMarkdown(cwd: string, planPath: string | undefined): string | undefined {
	if (!planPath) return undefined;
	const resolved = resolveMaybePath(cwd, planPath);
	try {
		if (!existsSync(resolved)) return undefined;
		const stat = statSync(resolved);
		if (!stat.isFile() || stat.size > 1_000_000) return undefined;
		return readFileSync(resolved, "utf-8");
	} catch {
		return undefined;
	}
}

function extractFeature(content: string, planPath?: string): string | undefined {
	const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
	if (heading) return heading.replace(/^Draft\s+/i, "").replace(/^(Implementation\s+)?Plan:\s*/i, "");
	return planPath ? basename(planPath).replace(/\.mdx?$/i, "") : undefined;
}

function extractTasksFromPlan(content: string): StageTask[] {
	const tasks: StageTask[] = [];
	const matches = [...content.matchAll(/^###\s+Task\s+([^:\n]+)\s*:\s*(.+)$/gim)];

	if (matches.length > 0) {
		for (let i = 0; i < matches.length; i++) {
			const match = matches[i]!;
			const rawId = match[1]!.trim();
			const taskId = /^t/i.test(rawId) ? rawId.replace(/\s+/g, "") : `T${rawId.replace(/\s+/g, "")}`;
			const title = match[2]!.trim();
			tasks.push({ id: taskId, title, status: "pending", level: 0 });

			const sectionStart = (match.index ?? 0) + match[0].length;
			const sectionEnd = i + 1 < matches.length ? matches[i + 1]!.index ?? content.length : content.length;
			const section = content.slice(sectionStart, sectionEnd);
			let subIndex = 0;
			for (const sub of section.matchAll(/^\s*[-*]\s+\[\s\]\s+(.+)$/gim)) {
				const subTitle = sub[1]?.trim();
				if (!subTitle) continue;
				subIndex++;
				tasks.push({ id: `${taskId}.${subIndex}`, title: subTitle, status: "pending", level: 1, parentId: taskId });
			}
		}
		return tasks;
	}

	let index = 0;
	for (const match of content.matchAll(/^\s*[-*]\s+\[\s\]\s+(.+)$/gim)) {
		const title = match[1]?.trim();
		if (!title) continue;
		index++;
		tasks.push({ id: `T${index}`, title, status: "pending", level: 0 });
	}
	return tasks;
}

function normalizeTasks(input: Array<{ id?: string; title: string; status?: TaskStatus; level?: number; parentId?: string; note?: string }> | undefined): StageTask[] {
	return (input || [])
		.map((task, index) => ({
			id: task.id?.trim() || `T${index + 1}`,
			title: task.title.trim(),
			status: task.status ?? "pending",
			level: task.level ?? 0,
			parentId: task.parentId,
			note: task.note,
		}))
		.filter((task) => task.title.length > 0);
}

function findTask(state: StageProgressState, input: { taskId?: string; taskIndex?: number; taskTitle?: string }): StageTask | undefined {
	if (input.taskId) return state.tasks.find((task) => task.id === input.taskId);
	if (input.taskIndex !== undefined) {
		const index = Math.max(1, Math.floor(input.taskIndex)) - 1;
		return state.tasks[index];
	}
	if (input.taskTitle) {
		const needle = normalizeText(input.taskTitle);
		return state.tasks.find((task) => {
			const hay = normalizeText(`${task.id} ${task.title}`);
			return hay.includes(needle) || needle.includes(hay);
		});
	}
	if (state.currentTaskId) return state.tasks.find((task) => task.id === state.currentTaskId);
	return state.tasks.find((task) => task.status === "pending") ?? state.tasks[0];
}

function matchTaskFromText(state: StageProgressState, text: string | undefined): StageTask | undefined {
	if (!text) return undefined;
	const needle = normalizeText(text);
	let best: { task: StageTask; score: number } | undefined;
	for (const task of state.tasks) {
		const title = normalizeText(task.title);
		const id = normalizeText(task.id);
		let score = 0;
		if (needle.includes(title)) score += Math.min(100, title.length);
		if (needle.includes(id)) score += 20;
		if (!best || score > best.score) best = { task, score };
	}
	return best && best.score > 20 ? best.task : undefined;
}

function taskCounts(state: StageProgressState): { total: number; done: number; blocked: number } {
	const total = state.tasks.length;
	const done = state.tasks.filter((task) => task.status === "done" || task.status === "skipped").length;
	const blocked = state.tasks.filter((task) => task.status === "blocked").length;
	return { total, done, blocked };
}

function statusGlyph(status: TaskStatus, isCurrent: boolean, theme: Theme): string {
	if (status === "done") return theme.fg("success", "✓");
	if (status === "blocked") return theme.fg("error", "✗");
	if (status === "skipped") return theme.fg("dim", "-");
	if (status === "committing") return theme.fg("accent", "◆");
	if (status === "fixing") return theme.fg("warning", "◒");
	if (status === "reviewing") return theme.fg("warning", "◐");
	if (status === "running" || isCurrent) return theme.fg("accent", "●");
	return theme.fg("dim", "○");
}

function statusColor(status: TaskStatus, isCurrent: boolean): Parameters<Theme["fg"]>[0] {
	if (status === "done") return "muted";
	if (status === "blocked") return "error";
	if (status === "fixing" || status === "reviewing") return "warning";
	if (status === "committing" || status === "running" || isCurrent) return "accent";
	return "dim";
}

function plainTruncate(value: string, width: number): string {
	return truncateToWidth(value, Math.max(1, width), "…");
}

function selectVisibleTasks(state: StageProgressState, budget: number): StageTask[] {
	if (state.tasks.length <= budget) return state.tasks;
	const currentIndex = state.currentTaskId ? state.tasks.findIndex((task) => task.id === state.currentTaskId) : -1;
	if (currentIndex < 0) return state.tasks.slice(0, budget);
	const before = Math.max(0, currentIndex - Math.floor((budget - 1) / 2));
	return state.tasks.slice(before, before + budget);
}

function buildWidgetLines(state: StageProgressState, theme: Theme, cwd: string, width: number): string[] {
	const lines: string[] = [];
	const counts = taskCounts(state);
	const title = state.feature || "Implementation";
	const headerIcon = counts.blocked > 0 ? theme.fg("error", "✗") : state.completedAt ? theme.fg("success", "✓") : theme.fg("accent", "●");
	const bold = (theme as { bold?: (value: string) => string }).bold ?? ((value: string) => value);
	lines.push(plainTruncate(`${headerIcon} ${theme.fg("toolTitle", bold("Staged implementation"))} ${theme.fg("dim", `· ${counts.done}/${counts.total || 0} done`)}`, width));
	lines.push(plainTruncate(theme.fg("muted", title), width));

	const plan = shortPath(cwd, state.planPath);
	const liveParts = [state.currentAgent, state.currentActivity, state.message].filter(Boolean) as string[];
	if (liveParts.length > 0) lines.push(plainTruncate(theme.fg("dim", `⎿ ${liveParts.join(" · ")}`), width));
	else if (plan) lines.push(plainTruncate(theme.fg("dim", `plan: ${plan}`), width));

	const rows = process.stdout.rows || 30;
	const taskBudget = Math.max(4, Math.min(14, Math.floor(rows * 0.28)));
	const visibleTasks = selectVisibleTasks(state, taskBudget);
	const firstVisibleIndex = visibleTasks.length ? state.tasks.indexOf(visibleTasks[0]!) : 0;
	if (firstVisibleIndex > 0) lines.push(plainTruncate(theme.fg("dim", `  … ${firstVisibleIndex} earlier task(s)`), width));

	for (const task of visibleTasks) {
		const isCurrent = task.id === state.currentTaskId;
		const indent = "  ".repeat(Math.max(0, task.level ?? 0));
		const marker = isCurrent ? theme.fg("accent", "▶") : " ";
		const glyph = statusGlyph(task.status, isCurrent, theme);
		const label = `${indent}${marker} ${glyph} ${task.id} ${task.title}${task.note ? ` — ${task.note}` : ""}`;
		lines.push(plainTruncate(theme.fg(statusColor(task.status, isCurrent), label), width));
	}

	const hiddenAfter = Math.max(0, state.tasks.length - firstVisibleIndex - visibleTasks.length);
	if (hiddenAfter > 0) lines.push(plainTruncate(theme.fg("dim", `  … ${hiddenAfter} later task(s)`), width));
	return lines.filter((line) => visibleWidth(line) > 0);
}

function updateUi(ctx: ExtensionContext, state: StageProgressState): void {
	if (!ctx.hasUI) return;
	if (!state.active) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.setStatus(WIDGET_KEY, undefined);
		(ctx.ui as { requestRender?: () => void }).requestRender?.();
		return;
	}
	const counts = taskCounts(state);
	const statusText = counts.total > 0 ? `🧭 ${counts.done}/${counts.total}` : "🧭 staged";
	ctx.ui.setStatus(WIDGET_KEY, ctx.ui.theme.fg(counts.blocked > 0 ? "error" : "accent", statusText));
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
		render: (width: number) => buildWidgetLines(state, theme, ctx.cwd, width),
		invalidate: () => {},
	}));
	(ctx.ui as { requestRender?: () => void }).requestRender?.();
}

function persist(pi: ExtensionAPI, state: StageProgressState): void {
	pi.appendEntry(STATE_TYPE, state);
}

function applyTaskUpdate(state: StageProgressState, task: StageTask | undefined, status: TaskStatus | undefined, note?: string): void {
	if (!task) return;
	if (status) task.status = status;
	if (note !== undefined) task.note = note;
	if (status && ["running", "reviewing", "fixing", "committing", "blocked"].includes(status)) state.currentTaskId = task.id;
	if (status === "done" && state.currentTaskId === task.id) {
		const next = state.tasks.find((t) => t.status === "pending");
		state.currentTaskId = next ? next.id : undefined;
	}
}

function activityFromProgress(progress: any, cwd: string): string | undefined {
	if (!progress) return undefined;
	const parts: string[] = [];
	if (typeof progress.currentTool === "string" && progress.currentTool) parts.push(progress.currentTool);
	if (typeof progress.currentPath === "string" && progress.currentPath) parts.push(shortPath(cwd, progress.currentPath) || progress.currentPath);
	if (parts.length > 0) return parts.join(" ");
	const recentOutput = Array.isArray(progress.recentOutput) ? progress.recentOutput.filter((line: unknown) => typeof line === "string" && line.trim()) : [];
	if (recentOutput.length > 0) return String(recentOutput[recentOutput.length - 1]).trim().slice(0, 120);
	if (progress.status === "running") return "thinking…";
	return undefined;
}

function runningProgressFromResult(result: any): any | undefined {
	const details = result?.details;
	const progressEntries = Array.isArray(details?.progress) ? details.progress : [];
	const resultProgressEntries = Array.isArray(details?.results) ? details.results.map((r: any) => r?.progress).filter(Boolean) : [];
	return [...progressEntries, ...resultProgressEntries].find((p) => p?.status === "running")
		?? [...progressEntries, ...resultProgressEntries].filter(Boolean).pop();
}

function subagentStatus(agent: string | undefined): TaskStatus | undefined {
	if (!agent) return undefined;
	if (agent === "fix-worker") return "fixing";
	if (agent.endsWith("reviewer") || agent.includes("reviewer")) return "reviewing";
	if (agent === "plan-implementer") return "running";
	return undefined;
}

function updateFromSubagentArgs(state: StageProgressState, args: any): void {
	if (!state.active || args?.action) return;
	let agent: string | undefined = typeof args?.agent === "string" ? args.agent : undefined;
	let taskText: string | undefined = typeof args?.task === "string" ? args.task : undefined;
	if (!agent && Array.isArray(args?.tasks) && args.tasks.length > 0) {
		agent = args.tasks.map((task: any) => task?.agent).filter(Boolean).join(", ");
		taskText = args.tasks.map((task: any) => task?.task).filter(Boolean).join("\n");
	}
	if (!agent && Array.isArray(args?.chain) && args.chain.length > 0) {
		agent = "chain";
		taskText = args.chain.map((step: any) => step?.task).filter(Boolean).join("\n");
	}
	const status = subagentStatus(agent);
	const matched = matchTaskFromText(state, taskText);
	if (matched && status) applyTaskUpdate(state, matched, status);
	state.currentAgent = agent;
	state.currentActivity = status ? "started" : state.currentActivity;
	state.updatedAt = Date.now();
}

function summarize(state: StageProgressState): string {
	if (!state.active) return "Stage progress inactive";
	const counts = taskCounts(state);
	const current = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) : undefined;
	return `Stage progress: ${counts.done}/${counts.total} done${current ? `; current ${current.id}: ${current.title}` : ""}`;
}

export default function stagedProgressExtension(pi: ExtensionAPI): void {
	let state: StageProgressState = emptyState();

	function restore(ctx: ExtensionContext): void {
		const entries = ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: StageProgressState }>;
		const latest = entries.filter((entry) => entry.type === "custom" && entry.customType === STATE_TYPE).pop();
		state = latest?.data && Array.isArray(latest.data.tasks) ? latest.data : emptyState();
		updateUi(ctx, state);
	}

	function startFromPlanPath(ctx: ExtensionContext, planPath: string): void {
		const content = safeReadMarkdown(ctx.cwd, planPath);
		const parsedTasks = content ? extractTasksFromPlan(content) : [];
		state = {
			active: true,
			planPath,
			feature: content ? extractFeature(content, planPath) : basename(planPath),
			phase: "implementation",
			tasks: parsedTasks,
			startedAt: Date.now(),
			updatedAt: Date.now(),
			message: parsedTasks.length > 0
				? "plan loaded"
				: content
					? "plan has no parseable tasks (### Task N: or - [ ]); waiting for stage_progress"
					: `plan not readable at ${planPath}; waiting for stage_progress`,
		};
		persist(pi, state);
		updateUi(ctx, state);
	}

	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));

	pi.on("input", async (event: any, ctx) => {
		if (event?.source === "extension") return { action: "continue" };
		const text = String(event?.text ?? "").trim();
		const match = text.match(/^\/implement-plan\s+(.+)$/);
		if (!match) return { action: "continue" };
		const activeTools = pi.getActiveTools();
		if (!activeTools.includes(TOOL_NAME)) pi.setActiveTools([...activeTools, TOOL_NAME]);
		startFromPlanPath(ctx, match[1]!.trim());
		return { action: "continue" };
	});

	pi.on("tool_call", async (event: any, ctx) => {
		if (event?.toolName !== "subagent") return;
		updateFromSubagentArgs(state, event.input);
		updateUi(ctx, state);
	});

	pi.on("tool_execution_update", async (event: any, ctx) => {
		if (event?.toolName !== "subagent" || !state.active) return;
		const progress = runningProgressFromResult(event.partialResult);
		if (!progress) return;
		if (typeof progress.agent === "string") state.currentAgent = progress.agent;
		state.currentActivity = activityFromProgress(progress, ctx.cwd) ?? state.currentActivity;
		const matched = matchTaskFromText(state, typeof progress.task === "string" ? progress.task : undefined);
		const status = subagentStatus(progress.agent);
		if (matched && status) applyTaskUpdate(state, matched, status);
		state.updatedAt = Date.now();
		updateUi(ctx, state);
	});

	pi.on("tool_result", async (event: any, ctx) => {
		if (event?.toolName !== "subagent" || !state.active) return;
		const progress = runningProgressFromResult(event);
		if (progress && typeof progress.agent === "string") state.currentAgent = progress.agent;
		state.currentActivity = "subagent returned; parent verifying";
		state.updatedAt = Date.now();
		updateUi(ctx, state);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!state.active) return;
		state.currentAgent = undefined;
		state.currentActivity = state.completedAt ? "complete" : "waiting for next step";
		state.updatedAt = Date.now();
		persist(pi, state);
		updateUi(ctx, state);
	});

	pi.registerCommand("stage-progress", {
		description: "Show, load, or clear staged implementation progress",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (trimmed === "clear") {
				state = emptyState();
				persist(pi, state);
				updateUi(ctx, state);
				ctx.ui.notify("Staged progress cleared", "info");
				return;
			}
			if (trimmed) {
				startFromPlanPath(ctx, trimmed);
				ctx.ui.notify(summarize(state), "info");
				return;
			}
			updateUi(ctx, state);
			ctx.ui.notify(summarize(state), "info");
		},
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Stage Progress",
		description: "Update visible staged implementation task progress widget. Use during /implement-plan to show full task queue and current task.",
		promptSnippet: "Update visible staged implementation task progress widget",
		promptGuidelines: [
			"Use stage_progress during /implement-plan: start with ordered tasks, set current task before each writer/review/fix/validation/commit, mark done/blocked after validation and task commit, and finish at completion.",
		],
		parameters: StageProgressParams,
		async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
			const now = Date.now();
			const action = params.action as StageProgressAction;

			if (action === "clear") {
				state = emptyState();
				persist(pi, state);
				updateUi(ctx, state);
				return { content: [{ type: "text" as const, text: "Stage progress cleared" }], details: state };
			}

			if (action === "start") {
				const content = safeReadMarkdown(ctx.cwd, params.planPath);
				const tasks = normalizeTasks(params.tasks);
				state = {
					active: true,
					planPath: params.planPath ?? state.planPath,
					feature: params.feature ?? (content ? extractFeature(content, params.planPath) : state.feature),
					phase: params.phase ?? "implementation",
					tasks: tasks.length > 0 ? tasks : content ? extractTasksFromPlan(content) : [],
					currentTaskId: undefined,
					currentAgent: params.agent,
					currentActivity: params.activity,
					message: params.message ?? "started",
					startedAt: now,
					updatedAt: now,
				};
			} else if (action === "list") {
				// no-op
			} else if (action === "finish") {
				state.active = true;
				state.completedAt = now;
				state.currentActivity = params.activity ?? "complete";
				state.message = params.message ?? "finished";
				state.updatedAt = now;
			} else {
				state.active = true;
				const target = findTask(state, params);
				const status: TaskStatus | undefined = action === "complete_task"
					? "done"
					: action === "block_task"
						? "blocked"
						: params.status;
				applyTaskUpdate(state, target, status, params.note);
				if (target && (action === "set_task" || action === "update")) state.currentTaskId = target.id;
				if (params.agent !== undefined) state.currentAgent = params.agent;
				if (params.activity !== undefined) state.currentActivity = params.activity;
				if (params.message !== undefined) state.message = params.message;
				state.updatedAt = now;
			}

			persist(pi, state);
			updateUi(ctx, state);
			return { content: [{ type: "text" as const, text: summarize(state) }], details: state };
		},
	});
}
