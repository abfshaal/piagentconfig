import { execFile, spawn } from "node:child_process";
import http from "node:http";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ChatMessage = {
	role?: string;
	content?: unknown;
	tool_calls?: Array<{
		id?: string;
		function?: { name?: string; arguments?: string };
	}>;
	tool_call_id?: string;
	name?: string;
};

type OpenAiToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

type ProxyState = {
	server?: http.Server;
	baseUrl?: string;
	port?: number;
};

const GLOBAL_KEY = "__pi_cursor_acp_proxy_provider__";
const PROVIDER_ID = "cursor-acp";
const HOST = "127.0.0.1";
const DEFAULT_PORT = 32124;
const API_KEY = "cursor-agent";
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 16_384;

const FALLBACK_MODELS = [
	{ id: "cursor-acp/auto", name: "Cursor Auto" },
	{ id: "cursor-acp/sonnet-4.5", name: "Cursor Sonnet 4.5" },
	{ id: "cursor-acp/sonnet-4.5-thinking", name: "Cursor Sonnet 4.5 Thinking" },
	{ id: "cursor-acp/gpt-5", name: "Cursor GPT-5" },
	{ id: "cursor-acp/gpt-5.1-codex", name: "Cursor GPT-5.1 Codex" },
];

const TOOL_NAME_ALIASES = new Map<string, string>([
	["shell", "bash"],
	["terminal", "bash"],
	["runcommand", "bash"],
	["executecommand", "bash"],
	["bashcommand", "bash"],
	["findfiles", "glob"],
	["searchfiles", "glob"],
	["listfiles", "ls"],
	["listdirectory", "ls"],
	["readfile", "read"],
	["writefile", "write"],
	["editfile", "edit"],
	["askuser", "ask_user_question"],
	["askuserquestion", "ask_user_question"],
	["delegatetask", "subagent"],
	["subagent", "subagent"],
]);

export default async function (pi: ExtensionAPI) {
	const state = await ensureProxy();
	const models = await discoverModels().catch(() => FALLBACK_MODELS);

	pi.registerProvider(PROVIDER_ID, {
		name: "Cursor ACP (local proxy)",
		baseUrl: state.baseUrl!,
		apiKey: API_KEY,
		api: "openai-completions",
		compat: {
			supportsReasoningEffort: false,
		},
		models: models.map((model) => ({
			id: model.id,
			name: model.name,
			reasoning: false,
			input: ["text"],
			contextWindow: DEFAULT_CONTEXT_WINDOW,
			maxTokens: DEFAULT_MAX_TOKENS,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		})),
	});

	pi.registerCommand("cursor-acp-status", {
		description: "Show Cursor ACP local proxy status",
		handler: async (_args, ctx) => {
			const health = await fetch(`${state.baseUrl!.replace(/\/v1\/?$/, "")}/health`).then((r) => r.json()).catch((error) => ({ ok: false, error: String(error) }));
			ctx.ui.notify(
				`Cursor ACP proxy: ${health.ok ? "ok" : "not ok"}\nBase URL: ${state.baseUrl}\nModels: ${models.length}\nCursor CLI: ${await resolveCursorAgentBinary().catch(() => "not found")}`,
				health.ok ? "info" : "warning",
			);
		},
	});

	pi.registerCommand("cursor-acp-setup", {
		description: "Show Cursor ACP setup commands",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				"Install/login if needed:\n  curl https://cursor.com/install -fsS | bash\n  agent login\n\nThen run /reload and pick cursor-acp/auto in /model.",
				"info",
			);
		},
	});
}

async function ensureProxy(): Promise<ProxyState> {
	const globalState = globalThis as unknown as Record<string, ProxyState>;
	const existing = globalState[GLOBAL_KEY];
	if (existing?.server && existing.baseUrl) return existing;

	let server = http.createServer(handleRequest);
	const requestedPort = Number(process.env.CURSOR_ACP_PROXY_PORT || DEFAULT_PORT);
	let port = requestedPort;

	try {
		await listen(server, requestedPort);
	} catch (error: any) {
		if (error?.code !== "EADDRINUSE") throw error;
		server = http.createServer(handleRequest);
		await listen(server, 0);
		const address = server.address();
		if (typeof address === "object" && address?.port) port = address.port;
	}

	const state: ProxyState = { server, port, baseUrl: `http://${HOST}:${port}/v1` };
	globalState[GLOBAL_KEY] = state;
	return state;
}

async function listen(server: http.Server, port: number) {
	await new Promise<void>((resolvePromise, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolvePromise();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, HOST);
	});
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
	try {
		const url = new URL(req.url || "/", `http://${req.headers.host || HOST}`);
		setCors(res);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (url.pathname === "/health") {
			json(res, 200, { ok: true, provider: PROVIDER_ID, workspace: workspaceDirectory() });
			return;
		}

		if (url.pathname === "/v1/models" || url.pathname === "/models") {
			const models = await discoverModels().catch(() => FALLBACK_MODELS);
			json(res, 200, {
				object: "list",
				data: models.map((model) => ({ id: model.id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "cursor" })),
			});
			return;
		}

		if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
			json(res, 404, { error: `Unsupported path: ${url.pathname}` });
			return;
		}

		const body = await readJson(req);
		const response = await runCursorCompletion(body);

		if (body?.stream === true) {
			writeSseResponse(res, response);
			return;
		}

		json(res, 200, response);
	} catch (error) {
		json(res, 500, { error: error instanceof Error ? error.message : String(error) });
	}
}

async function runCursorCompletion(body: any) {
	const model = normalizeModel(String(body?.model || "cursor-acp/auto"));
	const tools = Array.isArray(body?.tools) ? body.tools : [];
	const allowedToolNames = extractAllowedToolNames(tools);
	const prompt = buildPromptFromMessages(Array.isArray(body?.messages) ? body.messages : [], tools);
	const { stdout, stderr, code } = await runCursorAgent(model, prompt);
	const meta = { id: `cursor-acp-${Date.now()}`, created: Math.floor(Date.now() / 1000), model };

	const toolCall = findFirstAllowedToolCall(stdout, allowedToolNames);
	if (toolCall) return createToolCallCompletion(meta, toolCall);

	if (code !== 0) {
		return createChatCompletion(meta, cursorErrorMessage(stderr || stdout || `cursor-agent exited with code ${code}`));
	}

	const completion = extractCompletion(stdout);
	return createChatCompletion(meta, completion.assistantText || completion.resultText || stdout || stderr, completion.reasoningText || undefined);
}

async function runCursorAgent(model: string, prompt: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
	const binary = await resolveCursorAgentBinary();
	const args = [
		"--print",
		"--output-format",
		"stream-json",
		"--stream-partial-output",
		"--workspace",
		workspaceDirectory(),
		"--model",
		model,
		"--force",
	];

	return new Promise((resolvePromise) => {
		const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
		child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
		child.stdin.on("error", () => {
			// cursor-agent can exit early on auth/quota errors before stdin drains.
		});
		child.on("error", (error) => resolvePromise({ stdout: "", stderr: String(error.message || error), code: 1 }));
		child.on("close", (code) => resolvePromise({
			stdout: Buffer.concat(stdoutChunks).toString("utf8"),
			stderr: Buffer.concat(stderrChunks).toString("utf8"),
			code,
		}));

		child.stdin.write(prompt, () => child.stdin.end());
	});
}

function buildPromptFromMessages(messages: ChatMessage[], tools: any[]) {
	const lines: string[] = [];

	if (tools.length > 0) {
		const toolDescriptions = tools.map((tool) => {
			const fn = tool?.function || tool;
			return `- ${fn?.name || "unknown"}: ${fn?.description || ""}\n  Parameters: ${JSON.stringify(fn?.parameters || {})}`;
		}).join("\n");
		lines.push(
			"SYSTEM: You have access to tools from the client. When you need one, emit a tool_call in standard OpenAI function-call shape. Prefer client tools for file reads, edits, shell commands, and user questions.\n\nAvailable tools:\n" + toolDescriptions,
		);
	}

	for (const message of messages) {
		const role = typeof message.role === "string" ? message.role : "user";

		if (role === "tool") {
			lines.push(`TOOL_RESULT (call_id: ${message.tool_call_id || "unknown"}${message.name ? `, name: ${message.name}` : ""}): ${contentToText(message.content)}`);
			continue;
		}

		if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
			const calls = message.tool_calls.map((call) => `tool_call(id: ${call.id || "?"}, name: ${call.function?.name || "?"}, args: ${call.function?.arguments || "{}"})`);
			const text = contentToText(message.content);
			lines.push(`ASSISTANT: ${text ? `${text}\n` : ""}${calls.join("\n")}`);
			continue;
		}

		const text = contentToText(message.content);
		if (text) lines.push(`${role.toUpperCase()}: ${text}`);
	}

	if (messages.some((message) => message.role === "tool")) {
		lines.push("The above tool calls have been executed. Continue based on these results. If more client tools are needed, emit another tool_call.");
	}

	return lines.join("\n\n");
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map((part) => {
			if (part && typeof part === "object" && (part as any).type === "text") return String((part as any).text || "");
			return "";
		}).filter(Boolean).join("\n");
	}
	if (content == null) return "";
	return JSON.stringify(content);
}

function findFirstAllowedToolCall(output: string, allowedToolNames: Set<string>): OpenAiToolCall | null {
	if (allowedToolNames.size === 0) return null;
	for (const line of output.split(/\r?\n/)) {
		const event = parseEvent(line);
		if (!event || event.type !== "tool_call") continue;
		const toolCall = extractOpenAiToolCall(event, allowedToolNames);
		if (toolCall) return toolCall;
	}
	return null;
}

function extractOpenAiToolCall(event: any, allowedToolNames: Set<string>): OpenAiToolCall | null {
	let name = typeof event.name === "string" ? event.name : null;
	let args: unknown = undefined;
	const entries = Object.entries(event.tool_call || {});

	if (entries.length > 0) {
		const [rawName, payload] = entries[0] as [string, any];
		name ||= normalizeToolName(rawName);
		if (payload && typeof payload === "object") {
			args = payload.args;
			if (args === undefined) {
				const { result: _result, ...rest } = payload;
				if (Object.keys(rest).length > 0) args = rest;
			}
		}
	}

	if (!name) return null;
	const resolvedName = resolveAllowedToolName(normalizeToolName(name), allowedToolNames);
	if (!resolvedName) return null;

	return {
		id: event.call_id || event.tool_call_id || `call_${Date.now()}`,
		type: "function",
		function: {
			name: resolvedName,
			arguments: toOpenAiArguments(args),
		},
	};
}

function extractAllowedToolNames(tools: any[]) {
	const names = new Set<string>();
	for (const tool of tools) {
		const name = tool?.function?.name || tool?.name;
		if (typeof name === "string" && name) names.add(name);
	}
	return names;
}

function resolveAllowedToolName(name: string, allowed: Set<string>) {
	if (allowed.has(name)) return name;
	const normalized = normalizeAliasKey(name);
	for (const candidate of allowed) {
		if (normalizeAliasKey(candidate) === normalized) return candidate;
	}
	const alias = TOOL_NAME_ALIASES.get(normalized);
	if (!alias) return null;
	const normalizedAlias = normalizeAliasKey(alias);
	for (const candidate of allowed) {
		if (normalizeAliasKey(candidate) === normalizedAlias) return candidate;
	}
	return null;
}

function normalizeToolName(raw: string) {
	if (raw.endsWith("ToolCall")) {
		const base = raw.slice(0, -"ToolCall".length);
		return base.charAt(0).toLowerCase() + base.slice(1);
	}
	return raw;
}

function normalizeAliasKey(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toOpenAiArguments(args: unknown) {
	if (args === undefined) return "{}";
	if (typeof args === "string") {
		try {
			const parsed = JSON.parse(args);
			return typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed) : JSON.stringify({ value: parsed });
		} catch {
			return JSON.stringify({ value: args });
		}
	}
	if (typeof args === "object" && args !== null) return JSON.stringify(args);
	return JSON.stringify({ value: args });
}

function extractCompletion(output: string) {
	let assistantText = "";
	let reasoningText = "";
	let resultText = "";
	let lastAssistant = "";
	let lastThinking = "";

	for (const line of output.split(/\r?\n/)) {
		const event = parseEvent(line);
		if (!event) continue;
		if (event.type === "assistant") {
			const text = extractContent(event.message?.content, "text");
			if (text) {
				assistantText += diff(lastAssistant, text);
				lastAssistant = text;
			}
			const thinking = extractContent(event.message?.content, "thinking");
			if (thinking) {
				reasoningText += diff(lastThinking, thinking);
				lastThinking = thinking;
			}
		}
		if (event.type === "thinking" && typeof event.text === "string") {
			reasoningText += diff(lastThinking, event.text);
			lastThinking = event.text;
		}
		if (event.type === "result" && typeof event.result === "string") {
			resultText = event.result;
		}
	}

	return { assistantText, reasoningText, resultText };
}

function extractContent(content: unknown, type: "text" | "thinking") {
	if (!Array.isArray(content)) return "";
	return content.filter((item) => item && typeof item === "object" && (item as any).type === type)
		.map((item) => type === "text" ? String((item as any).text || "") : String((item as any).thinking || ""))
		.join("");
}

function diff(previous: string, next: string) {
	return next.startsWith(previous) ? next.slice(previous.length) : next;
}

function parseEvent(line: string) {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try { return JSON.parse(trimmed); } catch { return null; }
}

function createChatCompletion(meta: { id: string; created: number; model: string }, content: string, reasoning?: string) {
	const message: any = { role: "assistant", content };
	if (reasoning) message.reasoning_content = reasoning;
	return {
		id: meta.id,
		object: "chat.completion",
		created: meta.created,
		model: meta.model,
		choices: [{ index: 0, message, finish_reason: "stop" }],
	};
}

function createToolCallCompletion(meta: { id: string; created: number; model: string }, toolCall: OpenAiToolCall) {
	return {
		id: meta.id,
		object: "chat.completion",
		created: meta.created,
		model: meta.model,
		choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [toolCall] }, finish_reason: "tool_calls" }],
	};
}

function writeSseResponse(res: http.ServerResponse, response: any) {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const choice = response.choices?.[0];
	if (choice?.message?.tool_calls) {
		res.write(`data: ${JSON.stringify({ ...response, choices: [{ index: 0, delta: { role: "assistant", tool_calls: choice.message.tool_calls.map((call: OpenAiToolCall, index: number) => ({ index, ...call })) }, finish_reason: null }] })}\n\n`);
		res.write(`data: ${JSON.stringify({ ...response, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
	} else {
		const content = choice?.message?.content || "";
		res.write(`data: ${JSON.stringify({ ...response, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
		res.write(`data: ${JSON.stringify({ ...response, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
	}
	res.write("data: [DONE]\n\n");
	res.end();
}

async function discoverModels() {
	const binary = await resolveCursorAgentBinary();
	const output = await execFileText(binary, ["models"], 2500);
	const models = output.split(/\r?\n/)
		.map((line) => line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim())
		.map((line) => {
			const match = line.match(/^([a-z0-9._/-]+)\s+-\s+(.+?)(?:\s+\((?:current|default)\))*\s*$/i);
			if (!match) return null;
			const id = match[1].startsWith("cursor-acp/") ? match[1] : `cursor-acp/${match[1]}`;
			return { id, name: `Cursor ${match[2]}` };
		})
		.filter(Boolean) as Array<{ id: string; name: string }>;
	return models.length > 0 ? models : FALLBACK_MODELS;
}

async function resolveCursorAgentBinary() {
	const fromEnv = process.env.CURSOR_AGENT_BIN;
	if (fromEnv) return fromEnv;
	for (const candidate of ["cursor-agent", "agent"]) {
		try {
			await execFileText(candidate, ["--version"], 1500);
			return candidate;
		} catch {
			// try next
		}
	}
	throw new Error("cursor-agent not found. Install with: curl https://cursor.com/install -fsS | bash");
}

function execFileText(file: string, args: string[], timeout: number) {
	return new Promise<string>((resolvePromise, reject) => {
		execFile(file, args, { timeout }, (error, stdout, stderr) => {
			if (error) reject(new Error(String(stderr || error.message || error)));
			else resolvePromise(String(stdout));
		});
	});
}

function normalizeModel(model: string) {
	return model.startsWith(`${PROVIDER_ID}/`) ? model.slice(PROVIDER_ID.length + 1) || "auto" : model || "auto";
}

function workspaceDirectory() {
	return resolve(process.env.CURSOR_ACP_WORKSPACE || process.cwd());
}

function cursorErrorMessage(message: string) {
	if (/login|auth|unauthor/i.test(message)) return `${message}\n\nRun: agent login`;
	return message;
}

function readJson(req: http.IncomingMessage): Promise<any> {
	return new Promise((resolvePromise, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		req.on("error", reject);
		req.on("end", () => {
			try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
			catch (error) { reject(error); }
		});
	});
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(payload));
}

function setCors(res: http.ServerResponse) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
