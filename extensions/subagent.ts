import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";

const SUBAGENT_MODES = ["investigate", "review", "test", "web"] as const;
const SUBAGENT_AGENTS = ["scout", "researcher", "reviewer", "tester"] as const;
const WEB_TOOLS_EXTENSION = "/Users/abdulraheem.shaal1/.pi/agent/extensions/web-tools.ts";
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_PARALLEL_TASKS = 4;
const MAX_AGGREGATE_OUTPUT_CHARS = 50_000;

type SubagentMode = (typeof SUBAGENT_MODES)[number];
type SubagentAgent = (typeof SUBAGENT_AGENTS)[number];

type SubagentStatus = "pending" | "running" | "completed" | "failed";
type SubagentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface AgentConfig {
	name: SubagentAgent;
	mode: SubagentMode;
	description: string;
}

interface SubagentRunDetails {
	agent: SubagentAgent;
	mode: SubagentMode;
	status: SubagentStatus;
	task: string;
	tools: string;
	command: string[];
	code: number;
	killed: boolean;
	stderr?: string;
	truncated: boolean;
	durationMs: number;
	outputChars: number;
}

interface SubagentDetails {
	mode: "single" | "parallel";
	results: SubagentRunDetails[];
}

interface SingleParams {
	task?: string;
	mode?: SubagentMode;
	agent?: SubagentAgent;
	cwd?: string;
	timeoutSeconds?: number;
	maxOutputChars?: number;
}

interface ParallelTaskParams extends SingleParams {
	task: string;
}

interface ToolParams extends SingleParams {
	tasks?: ParallelTaskParams[];
	maxConcurrency?: number;
}

const AGENTS: Record<SubagentAgent, AgentConfig> = {
	scout: {
		name: "scout",
		mode: "investigate",
		description: "Fast read-only codebase recon. Finds files, traces patterns, reports evidence.",
	},
	researcher: {
		name: "researcher",
		mode: "web",
		description: "Web researcher. Searches and fetches source-backed current information.",
	},
	reviewer: {
		name: "reviewer",
		mode: "review",
		description: "Read-only risk/diff reviewer. Can run inspection commands, must not mutate files.",
	},
	tester: {
		name: "tester",
		mode: "test",
		description: "Isolated diagnostic/test runner. Can run tests/diagnostics, must not mutate files.",
	},
};

const MODE_DEFAULT_AGENT: Record<SubagentMode, SubagentAgent> = {
	investigate: "scout",
	web: "researcher",
	review: "reviewer",
	test: "tester",
};

// Use GPT-5.5/Codex-supported effort level "medium" for scout/researcher by default.
// Research guidance suggests low is often sufficient for bounded lookup, but medium is safer for synthesis/source judgment.
const AGENT_THINKING_LEVELS: Partial<Record<SubagentAgent, SubagentThinkingLevel>> = {
	scout: "medium",
	researcher: "medium",
};

const SubagentTaskSchema = Type.Object({
	task: Type.String({
		description:
			"Narrow, isolated task for a fresh subagent. Include exact question, files/areas to inspect, and desired output.",
	}),
	agent: Type.Optional(
		StringEnum(SUBAGENT_AGENTS, {
			description:
				"Named agent to run: scout = code recon; researcher = web research; reviewer = risk/diff review; tester = isolated tests/diagnostics.",
		}),
	),
	mode: Type.Optional(
		StringEnum(SUBAGENT_MODES, {
			description:
				"Legacy mode alias. investigate = scout; web = researcher; review = reviewer; test = tester.",
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for this subagent process." })),
	timeoutSeconds: Type.Optional(Type.Number({ description: "Timeout in seconds, default 600, max 1800." })),
	maxOutputChars: Type.Optional(
		Type.Number({ description: "Max report characters returned for this task, default 20000, max 50000." }),
	),
});

const SubagentParams = Type.Object({
	task: Type.Optional(Type.String({
		description:
			"Narrow, isolated task for a fresh subagent. Include exact question, files/areas to inspect, and desired output.",
	})),
	agent: Type.Optional(
		StringEnum(SUBAGENT_AGENTS, {
			description:
				"Named agent to run: scout = code recon; researcher = web research; reviewer = risk/diff review; tester = isolated tests/diagnostics.",
		}),
	),
	mode: Type.Optional(
		StringEnum(SUBAGENT_MODES, {
			description:
				"Legacy mode alias. investigate = scout; web = researcher; review = reviewer; test = tester.",
		}),
	),
	tasks: Type.Optional(
		Type.Array(SubagentTaskSchema, {
			description:
				"Parallel mode. Run up to 4 independent subagents. Each item accepts {agent, task, cwd, timeoutSeconds, maxOutputChars}.",
			maxItems: MAX_PARALLEL_TASKS,
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the subagent process in single mode." })),
	timeoutSeconds: Type.Optional(Type.Number({ description: "Timeout in seconds, default 600, max 1800." })),
	maxOutputChars: Type.Optional(Type.Number({ description: "Max report characters returned, default 20000, max 50000." })),
	maxConcurrency: Type.Optional(Type.Number({ description: "Parallel task concurrency, default 4, max 4." })),
});

function textContent(text: string) {
	return { type: "text" as const, text };
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value!)));
}

function isSubagentMode(value: string): value is SubagentMode {
	return SUBAGENT_MODES.includes(value as SubagentMode);
}

function isSubagentAgent(value: string): value is SubagentAgent {
	return SUBAGENT_AGENTS.includes(value as SubagentAgent);
}

function agentFor(params: SingleParams): SubagentAgent {
	if (params.agent) return params.agent;
	return MODE_DEFAULT_AGENT[params.mode ?? "investigate"];
}

function modeFor(params: SingleParams): SubagentMode {
	if (params.agent) return AGENTS[params.agent].mode;
	return params.mode ?? "investigate";
}

function toolsForMode(mode: SubagentMode): string {
	switch (mode) {
		case "investigate":
			return "read,grep,find,ls";
		case "review":
		case "test":
			return "read,grep,find,ls,bash";
		case "web":
			return "web_search,web_fetch,fetch_url";
	}
}

function buildSubagentPrompt(task: string, mode: SubagentMode, agent: SubagentAgent): string {
	if (agent === "researcher") {
		return `You are a fresh web-research subagent for a main coding agent. Your job is to find current, source-backed information without polluting the main context.

Agent: researcher
Mode: web
Task:
${task}

Hard constraints:
- Use web_search first unless the task already provides specific URLs.
- Fetch original/source pages with web_fetch or fetch_url before making claims.
- Prefer primary sources: official docs, release notes, specs, repos, issue trackers, vendor docs.
- Do not use local file/code tools. Do not modify anything.
- Keep scope narrow. Stop when enough evidence answers the task.
- If sources conflict, say so and rank source quality.

Return concise report, max 80 lines, using this format:
Summary:
- ...
Sources:
- URL — why source matters — key fact
Findings:
- ...
Risks / uncertainty:
- ...
Recommended next step for main agent:
- ...`;
	}

	const role =
		agent === "scout"
			? "Fast codebase recon. Explore files, find patterns, map architecture."
			: agent === "reviewer"
				? "Focused reviewer. Inspect diffs, risks, tests, compatibility, and failure modes."
				: "Focused tester. Run safe diagnostics/tests and report exact observed output.";

	const bashRule =
		mode === "investigate"
			? "- You do not have bash. Use read/grep/find/ls only."
			: "- Bash is allowed only for read-only inspection or tests. Do not edit files, install packages, format code, delete/move/copy files, redirect output into files, or mutate repo state.";

	return `You are a fresh subagent for a main coding agent. Your job is to reduce main-agent context load.

Agent: ${agent}
Role: ${role}
Mode: ${mode}
Task:
${task}

Hard constraints:
- Do not modify files. Main agent owns all edits.
- Do not make broad architecture decisions. Report evidence and options.
- Stay narrow. Inspect only what task needs.
${bashRule}
- Prefer exact file paths, symbols, commands run, and observed outputs.
- If task is impossible or ambiguous, say what is missing.

Return concise report, max 80 lines, using this format:
Summary:
- ...
Evidence:
- path:line or command -> finding
Files inspected:
- ...
Risks / unknowns:
- ...
Recommended next step for main agent:
- ...`;
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	const head = text.slice(0, Math.max(0, maxChars - 200));
	return {
		text: `${head}\n\n[Subagent output truncated: ${text.length} chars total, max ${maxChars}]`,
		truncated: true,
	};
}

function resolveSubagentCwd(baseCwd: string, requested?: string): string {
	const base = fs.realpathSync(path.resolve(baseCwd));
	if (!requested?.trim()) return base;
	const resolved = fs.realpathSync(path.resolve(base, requested));
	if (resolved !== base && !resolved.startsWith(base + path.sep)) {
		throw new Error(`Subagent cwd must stay inside current cwd: ${requested}`);
	}
	return resolved;
}

function buildPiArgs(ctx: ExtensionContext, pi: ExtensionAPI, prompt: string, mode: SubagentMode, agent: SubagentAgent, tools: string): string[] {
	const args = ["--no-session", "--no-extensions"];
	if (mode === "web") {
		args.push("-e", WEB_TOOLS_EXTENSION);
	}
	args.push("--tools", tools);

	if (ctx.model) {
		args.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
	}

	const thinking = AGENT_THINKING_LEVELS[agent] ?? pi.getThinkingLevel();
	if (thinking) {
		args.push("--thinking", thinking);
	}

	args.push("-p", prompt);
	return args;
}

async function runSubagent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	params: SingleParams,
	signal?: AbortSignal,
	onStatus?: (details: SubagentRunDetails) => void,
) {
	const task = params.task?.trim() ?? "";
	if (!task) {
		return {
			content: [textContent("Error: task required")],
			details: undefined,
			isError: true,
		};
	}

	const agent = agentFor(params);
	const mode = modeFor(params);
	const tools = toolsForMode(mode);
	const timeoutMs = clampNumber(params.timeoutSeconds, 600, 30, 1800) * 1000;
	const maxOutputChars = clampNumber(params.maxOutputChars, 20_000, 1_000, 50_000);
	const prompt = buildSubagentPrompt(task, mode, agent);
	const args = buildPiArgs(ctx, pi, prompt, mode, agent, tools);
	const start = Date.now();

	const runningDetails: SubagentRunDetails = {
		agent,
		mode,
		status: "running",
		task,
		tools,
		command: ["pi", ...args.slice(0, -1), "<prompt>"],
		code: -1,
		killed: false,
		truncated: false,
		durationMs: 0,
		outputChars: 0,
	};
	onStatus?.(runningDetails);

	try {
		const result = await pi.exec("pi", args, { cwd: resolveSubagentCwd(ctx.cwd, params.cwd), timeout: timeoutMs, signal });
		const durationMs = Date.now() - start;
		const combined = result.stdout.trim() || result.stderr.trim() || "(no output)";
		const stderr = result.stderr.trim();
		const statusLine = result.code === 0 ? "" : `\n\n[Subagent exited with code ${result.code}${result.killed ? ", killed/timeout" : ""}]`;
		const stderrLine = stderr && result.stdout.trim() ? `\n\n[stderr]\n${stderr}` : "";
		const truncated = truncate(`${combined}${statusLine}${stderrLine}`, maxOutputChars);
		const finalText = truncated.text;

		const details: SubagentRunDetails = {
			agent,
			mode,
			status: result.code === 0 ? "completed" : "failed",
			task,
			tools,
			command: ["pi", ...args.slice(0, -1), "<prompt>"],
			code: result.code,
			killed: result.killed,
			stderr: stderr || undefined,
			truncated: truncated.truncated,
			durationMs,
			outputChars: finalText.length,
		};

		onStatus?.(details);
		return {
			content: [textContent(finalText)],
			details,
			isError: result.code !== 0,
		};
	} catch (error) {
		const durationMs = Date.now() - start;
		const message = error instanceof Error ? error.message : String(error);
		const details: SubagentRunDetails = {
			agent,
			mode,
			status: "failed",
			task,
			tools,
			command: ["pi", ...args.slice(0, -1), "<prompt>"],
			code: -1,
			killed: signal?.aborted ?? false,
			stderr: message,
			truncated: false,
			durationMs,
			outputChars: message.length,
		};
		onStatus?.(details);
		return {
			content: [textContent(`Subagent failed: ${message}`)],
			details,
			isError: true,
		};
	}
}

async function mapConcurrent<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const i = nextIndex++;
			results[i] = await fn(items[i], i);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function formatResultSummary(r: SubagentRunDetails): string {
	const status = r.status === "completed" ? "ok" : r.status;
	return `${r.agent}/${r.mode}: ${status}, exit ${r.code}, ${formatDuration(r.durationMs)}, ${r.outputChars} chars`;
}

function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
	const text = result.content?.[0];
	return text?.type === "text" ? text.text ?? "" : "";
}

function buildParallelOutput(results: Array<{ text: string; details: SubagentRunDetails }>): string {
	return results
		.map(({ text, details }) => {
			const failed = details.code !== 0 ? " (FAILED)" : "";
			return `## ${details.agent}${failed}\n\n${text || "(no output)"}`;
		})
		.join("\n\n---\n\n");
}

function renderRunDetails(r: SubagentRunDetails, theme: ExtensionContext["ui"]["theme"], expanded: boolean, width: number) {
	const icon =
		r.status === "running"
			? theme.fg("warning", "⟳")
			: r.status === "pending"
				? theme.fg("dim", "○")
				: r.code === 0
					? theme.fg("success", "✓")
					: theme.fg("error", "✗");
	const c = new Container();
	const summary = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))} ${theme.fg("accent", r.mode)} ${theme.fg("dim", `exit ${r.code} · ${formatDuration(r.durationMs)} · ${r.outputChars} chars`)}`;
	c.addChild(new Text(truncateToWidth(summary, width), 0, 0));
	const task = expanded ? r.task : r.task.replace(/\n/g, " ");
	c.addChild(new Text(truncateToWidth(theme.fg("dim", `Task: ${task}`), width), 0, 0));
	if (expanded) {
		c.addChild(new Text(theme.fg("muted", `Tools: ${r.tools}`), 0, 0));
		if (r.stderr) c.addChild(new Text(theme.fg("error", `stderr: ${r.stderr.slice(0, 500)}`), 0, 0));
	}
	return c;
}

function parseCommandArgs(args: string): SingleParams & { listAgents?: boolean } {
	const trimmed = args.trim();
	if (!trimmed) return { task: "" };
	if (trimmed === "agents" || trimmed === "list") return { task: "", listAgents: true };
	const [first, ...rest] = trimmed.split(/\s+/);
	if (isSubagentAgent(first)) {
		return { agent: first, task: rest.join(" ").trim() };
	}
	if (isSubagentMode(first)) {
		return { mode: first, task: rest.join(" ").trim() };
	}
	return { task: trimmed };
}

function agentsListText(): string {
	return SUBAGENT_AGENTS.map((name) => `- ${name}: ${AGENTS[name].description}`).join("\n");
}

export default function subagentExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Run fresh, no-session pi subagents for isolated scout/researcher/reviewer/tester work. Supports legacy mode/task single mode and parallel tasks[]. Subagents should not edit files.",
		promptSnippet:
			"Spawn fresh no-session subagents: scout for codebase recon, researcher for web, reviewer for risk review, tester for diagnostics. Supports parallel tasks[].",
		promptGuidelines: [
			"Use subagent with agent=scout for repo/codebase investigations that may touch multiple files, broad searches, architecture tracing, unfamiliar areas, dependency/version checks, or evidence gathering.",
			"Use subagent with agent=researcher when the task needs internet/web research; ask for source-backed findings and fetched original sources.",
			"Use subagent with agent=reviewer to inspect larger diffs or risk areas before finalizing changes.",
			"Use subagent with agent=tester for isolated diagnostic/test probes when results may be noisy or context-heavy.",
			"Use subagent tasks[] only for multiple independent reasoning tasks. Do not use subagents to parallelize simple read/fetch calls.",
			"Keep subagent tasks specific. Include exact files, commands, URLs, success criteria, and desired output.",
			"Main agent owns edits. Subagents must not modify files; use them as context firewall and evidence collectors.",
			"Legacy mode is still supported: investigate=scout, web=researcher, review=reviewer, test=tester.",
		],
		parameters: SubagentParams,

		async execute(_toolCallId, params: ToolParams, signal, onUpdate, ctx) {
			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					throw new Error(`subagent tasks[] supports at most ${MAX_PARALLEL_TASKS} tasks`);
				}
				const taskList = params.tasks.map((task) => ({
					...task,
					task: typeof task.task === "string" ? task.task.trim() : "",
				}));
				const blankIndex = taskList.findIndex((task) => !task.task);
				if (blankIndex !== -1) {
					throw new Error(`subagent tasks[${blankIndex}].task is required`);
				}
				const concurrency = clampNumber(params.maxConcurrency, DEFAULT_MAX_CONCURRENCY, 1, DEFAULT_MAX_CONCURRENCY);
				const details: SubagentRunDetails[] = taskList.map((task) => {
					const agent = agentFor(task);
					const mode = modeFor(task);
					return {
						agent,
						mode,
						status: "pending",
						task: task.task,
						tools: toolsForMode(mode),
						command: [],
						code: -1,
						killed: false,
						truncated: false,
						durationMs: 0,
						outputChars: 0,
					};
				});

				const flush = () =>
					onUpdate?.({
						content: [textContent(`Running ${taskList.length} subagents (${concurrency} concurrent)...`)],
						details: { mode: "parallel", results: [...details] },
					});
				flush();

				const results = await mapConcurrent(taskList, concurrency, async (task, index) => {
					const result = await runSubagent(
						pi,
						ctx,
						{
							...task,
							timeoutSeconds: task.timeoutSeconds ?? params.timeoutSeconds,
							maxOutputChars: task.maxOutputChars ?? params.maxOutputChars,
						},
						signal,
						(update) => {
							details[index] = update;
							flush();
						},
					);
					if (result.details) details[index] = result.details;
					flush();
					return { text: firstText(result), details: result.details! };
				});

				const output = truncate(buildParallelOutput(results), MAX_AGGREGATE_OUTPUT_CHARS).text;
				const isError = results.some((r) => r.details.code !== 0);
				return {
					content: [textContent(output)],
					details: { mode: "parallel" as const, results: results.map((r) => r.details) },
					...(isError ? { isError: true } : {}),
				};
			}

			const single = await runSubagent(pi, ctx, params, signal, (update) => {
				onUpdate?.({
					content: [textContent(`Running ${update.agent}/${update.mode} subagent with tools: ${update.tools}`)],
					details: { mode: "single", results: [update] },
				});
			});
			return {
				content: single.content,
				details: single.details ? { mode: "single" as const, results: [single.details] } : undefined,
				...(single.isError ? { isError: true } : {}),
			};
		},

		renderCall(args, theme) {
			if (Array.isArray(args.tasks) && args.tasks.length > 0) {
				const names = args.tasks.map((task: Partial<ParallelTaskParams>) => task.agent ?? task.mode ?? "scout").join(", ");
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("accent", "parallel") +
						theme.fg("dim", ` (${args.tasks.length}: ${names})`),
					0,
					0,
				);
			}
			const agent = typeof args.agent === "string" ? args.agent : undefined;
			const mode = typeof args.mode === "string" ? args.mode : undefined;
			const label = agent ?? mode ?? "scout";
			const task = typeof args.task === "string" ? args.task.replace(/\n/g, " ") : "";
			const shortTask = task.length > 80 ? `${task.slice(0, 77)}...` : task;
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", label) +
					(shortTask ? " " + theme.fg("muted", shortTask) : ""),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as SubagentDetails | undefined;
			const report = firstText(result as { content?: Array<{ type: string; text?: string }> });
			if (!details?.results?.length) {
				if (expanded) return new Text(report, 0, 0);
				return new Text(report.split("\n").slice(0, 12).join("\n"), 0, 0);
			}

			const width = Math.max(40, (process.stdout.columns || 120) - 4);
			const c = new Container();
			if (details.mode === "parallel") {
				const done = details.results.filter((r) => r.status === "completed").length;
				const failed = details.results.filter((r) => r.status === "failed").length;
				const running = details.results.filter((r) => r.status === "running").length;
				const icon = running > 0 ? theme.fg("warning", "⟳") : failed > 0 ? theme.fg("error", "✗") : theme.fg("success", "✓");
				c.addChild(
					new Text(
						`${icon} ${theme.fg("toolTitle", theme.bold("parallel"))} ${theme.fg("dim", `${done}/${details.results.length} done · ${failed} failed`)}`,
						0,
						0,
					),
				);
				c.addChild(new Spacer(1));
			}

			for (let i = 0; i < details.results.length; i++) {
				c.addChild(renderRunDetails(details.results[i], theme, expanded, width));
				if (i < details.results.length - 1) c.addChild(new Spacer(1));
			}

			if (expanded) {
				c.addChild(new Spacer(1));
				c.addChild(new Text(report, 0, 0));
			} else {
				c.addChild(new Spacer(1));
				c.addChild(new Text(theme.fg("dim", "expand for full subagent report"), 0, 0));
			}
			return c;
		},
	});

	pi.registerCommand("subagent", {
		description: "Run a fresh no-session subagent: /subagent [scout|researcher|reviewer|tester|investigate|review|test|web] <task>",
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args);
			if (parsed.listAgents) {
				pi.sendMessage(
					{
						customType: "subagent-agents",
						content: agentsListText(),
						display: true,
					},
					{ triggerTurn: false },
				);
				return;
			}
			if (!parsed.task) {
				ctx.ui.notify("Usage: /subagent [scout|researcher|reviewer|tester|investigate|review|test|web] <task>", "warning");
				return;
			}

			const agent = agentFor(parsed);
			const mode = modeFor(parsed);
			ctx.ui.notify(`Running ${agent}/${mode} subagent...`, "info");
			const result = await runSubagent(pi, ctx, parsed, ctx.signal);
			const text = firstText(result);
			pi.sendMessage(
				{
					customType: "subagent-report",
					content: text,
					display: true,
					details: result.details ? { mode: "single", results: [result.details] } : undefined,
				},
				{ triggerTurn: false },
			);
		},
	});
}
