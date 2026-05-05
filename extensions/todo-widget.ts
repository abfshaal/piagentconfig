import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

interface Todo {
	id: number;
	text: string;
	done: boolean;
}

interface TodoDetails {
	action: "list" | "add" | "update" | "toggle" | "remove" | "clear";
	todos: Todo[];
	nextId: number;
	error?: string;
}

const TodoParams = Type.Object({
	action: StringEnum(["list", "add", "update", "toggle", "remove", "clear"] as const),
	text: Type.Optional(Type.String({ description: "Todo text (for add/update)" })),
	id: Type.Optional(Type.Number({ description: "Todo ID (for update/toggle/remove)" })),
});

function textContent(text: string) {
	return { type: "text" as const, text };
}

function userAskedToClearTodos(text: string) {
	const lower = text.toLowerCase();
	const todoRef = "(?:todo|todos|to-do|to-dos|task list|tasks)";
	return (
		new RegExp(`\\b(clear|reset)\\b.*\\b${todoRef}\\b`).test(lower) ||
		new RegExp(`\\b${todoRef}\\b.*\\b(clear|reset)\\b`).test(lower) ||
		new RegExp(`\\b(delete|remove)\\b.*\\ball\\b.*\\b${todoRef}\\b`).test(lower)
	);
}

function orderedTodos(todos: Todo[]): Todo[] {
	return [...todos].sort((a, b) => Number(a.done) - Number(b.done) || a.id - b.id);
}

class TodoListComponent {
	private todos: Todo[];
	private theme: Theme;
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(todos: Todo[], theme: Theme, onClose: () => void) {
		this.todos = todos;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		lines.push("");
		const title = th.fg("accent", " Todos ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No todos yet. Ask the agent to add some!")}`, width));
		} else {
			const done = this.todos.filter((t) => t.done).length;
			const total = this.todos.length;
			lines.push(truncateToWidth(`  ${th.fg("muted", `${done}/${total} completed`)}`, width));
			lines.push("");

			for (const todo of orderedTodos(this.todos)) {
				const check = todo.done ? th.fg("success", "✓") : th.fg("dim", "○");
				const id = th.fg("accent", `#${todo.id}`);
				const text = todo.done ? th.fg("dim", todo.text) : th.fg("text", todo.text);
				lines.push(truncateToWidth(`  ${check} ${id} ${text}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export default function todoWidgetExtension(pi: ExtensionAPI) {
	let todos: Todo[] = [];
	let nextId = 1;
	let clearRequestedByUser = false;
	let clearAllowedForNewRequest = false;

	const reconstructState = (ctx: ExtensionContext) => {
		todos = [];
		nextId = 1;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;

			const details = msg.details as TodoDetails | undefined;
			if (details) {
				todos = orderedTodos(details.todos);
				nextId = details.nextId;
			}
		}
	};

	const updateWidget = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (todos.length === 0) {
			ctx.ui.setWidget("todo-widget", undefined);
			return;
		}

		const lines = [ctx.ui.theme.fg("accent", "Todos")];
		for (const todo of orderedTodos(todos)) {
			const check = todo.done ? ctx.ui.theme.fg("success", "✓") : ctx.ui.theme.fg("dim", "○");
			const id = ctx.ui.theme.fg("accent", `#${todo.id}`);
			const text = todo.done ? ctx.ui.theme.fg("dim", todo.text) : ctx.ui.theme.fg("muted", todo.text);
			lines.push(`${check} ${id} ${text}`);
		}
		ctx.ui.setWidget("todo-widget", lines, { placement: "belowEditor" });
	};

	const syncState = (ctx: ExtensionContext) => {
		reconstructState(ctx);
		updateWidget(ctx);
	};

	pi.on("session_start", async (_event, ctx) => syncState(ctx));
	pi.on("session_tree", async (_event, ctx) => syncState(ctx));
	pi.on("input", async (event) => {
		clearRequestedByUser = userAskedToClearTodos(event.text);
		clearAllowedForNewRequest = event.text.trim().length > 0 && todos.length > 0;
	});
	pi.on("agent_end", async () => {
		clearRequestedByUser = false;
		clearAllowedForNewRequest = false;
	});

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description: "Manage a lightweight session todo list for small or ad hoc tasks. Do not use it for Plannotator-approved plans; Plannotator's plan checklist and progress widget are the source of truth there. Actions: list, add (text), update (id/text), toggle (id), remove (id), clear (for explicit user request or stale unrelated todos at start of a new request).",
		promptSnippet: "Track small/ad hoc multi-step work with a lightweight todo list. Do not use todo when Plannotator plan/execution progress is active.",
		promptGuidelines: [
			"Use the todo tool only for small, ad hoc, or non-Plannotator tasks where a lightweight visible checklist helps.",
			"Do not use the todo tool when Plannotator planning or execution is active, or when a Plannotator plan checklist exists. Use the Plannotator plan file, approved checklist, and [DONE:n] progress markers instead.",
			"If Plannotator is tracking an approved plan, treat Plannotator as the single source of truth for progress; do not duplicate its steps into todo items.",
			"For larger implementation tasks, prefer Plannotator planning/review over todo unless the user explicitly asks for a quick lightweight list.",
			"At the start of a new non-Plannotator request, inspect existing todos before adding more.",
			"If existing todos are completed or clearly belong to previous unrelated work, call todo clear first, then add todos for the new request.",
			"Do not clear todos when the new request continues, refines, or asks about the same non-Plannotator work.",
			"When using the todo tool, add todos before starting work, then work them in list order.",
			"When a todo is completed, immediately call the todo tool with action toggle for that id before starting the next todo.",
			"Completed todos move to the bottom; pending todos stay visible at the top in creation order.",
			"Use action clear only at the start of an unrelated request, or when the user explicitly asks to clear or reset the todo list.",
		],
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "list": {
					const visibleTodos = orderedTodos(todos);
					const result = {
						content: [
							{
								type: "text" as const,
								text: visibleTodos.length
									? visibleTodos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
									: "No todos",
							},
						],
						details: { action: "list", todos: visibleTodos, nextId } as TodoDetails,
					};
					updateWidget(ctx);
					return result;
				}

				case "add": {
					if (!params.text) {
						return {
							content: [textContent("Error: text required for add")],
							details: { action: "add", todos: [...todos], nextId, error: "text required" } as TodoDetails,
						};
					}
					const newTodo: Todo = { id: nextId++, text: params.text, done: false };
					todos.push(newTodo);
					todos = orderedTodos(todos);
					const result = {
						content: [textContent(`Added todo #${newTodo.id}: ${newTodo.text}`)],
						details: { action: "add", todos: [...todos], nextId } as TodoDetails,
					};
					updateWidget(ctx);
					return result;
				}

				case "update": {
					if (params.id === undefined) {
						return {
							content: [textContent("Error: id required for update")],
							details: { action: "update", todos: [...todos], nextId, error: "id required" } as TodoDetails,
						};
					}
					if (!params.text) {
						return {
							content: [textContent("Error: text required for update")],
							details: { action: "update", todos: [...todos], nextId, error: "text required" } as TodoDetails,
						};
					}
					const todo = todos.find((t) => t.id === params.id);
					if (!todo) {
						return {
							content: [textContent(`Todo #${params.id} not found`)],
							details: {
								action: "update",
								todos: [...todos],
								nextId,
								error: `#${params.id} not found`,
							} as TodoDetails,
						};
					}
					todo.text = params.text;
					const result = {
						content: [textContent(`Updated todo #${todo.id}: ${todo.text}`)],
						details: { action: "update", todos: [...todos], nextId } as TodoDetails,
					};
					updateWidget(ctx);
					return result;
				}

				case "toggle": {
					if (params.id === undefined) {
						return {
							content: [textContent("Error: id required for toggle")],
							details: { action: "toggle", todos: [...todos], nextId, error: "id required" } as TodoDetails,
						};
					}
					const todo = todos.find((t) => t.id === params.id);
					if (!todo) {
						return {
							content: [textContent(`Todo #${params.id} not found`)],
							details: {
								action: "toggle",
								todos: [...todos],
								nextId,
								error: `#${params.id} not found`,
							} as TodoDetails,
						};
					}
					todo.done = !todo.done;
					todos = orderedTodos(todos);
					const result = {
						content: [textContent(`Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}`)],
						details: { action: "toggle", todos: [...todos], nextId } as TodoDetails,
					};
					updateWidget(ctx);
					return result;
				}

				case "remove": {
					if (params.id === undefined) {
						return {
							content: [textContent("Error: id required for remove")],
							details: { action: "remove", todos: [...todos], nextId, error: "id required" } as TodoDetails,
						};
					}
					const index = todos.findIndex((t) => t.id === params.id);
					if (index === -1) {
						return {
							content: [textContent(`Todo #${params.id} not found`)],
							details: {
								action: "remove",
								todos: [...todos],
								nextId,
								error: `#${params.id} not found`,
							} as TodoDetails,
						};
					}
					const [removed] = todos.splice(index, 1);
					const result = {
						content: [textContent(`Removed todo #${removed.id}: ${removed.text}`)],
						details: { action: "remove", todos: [...todos], nextId } as TodoDetails,
					};
					updateWidget(ctx);
					return result;
				}

				case "clear": {
					if (!clearRequestedByUser && !clearAllowedForNewRequest) {
						return {
							content: [textContent("Error: clear requires explicit user request or stale unrelated todos at start of a new request")],
							details: {
								action: "clear",
								todos: [...todos],
								nextId,
								error: "clear requires explicit user request or stale unrelated todos at start of a new request",
							} as TodoDetails,
						};
					}
					clearRequestedByUser = false;
					clearAllowedForNewRequest = false;
					const count = todos.length;
					todos = [];
					nextId = 1;
					const result = {
						content: [textContent(`Cleared ${count} todos`)],
						details: { action: "clear", todos: [], nextId: 1 } as TodoDetails,
					};
					updateWidget(ctx);
					return result;
				}
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
			if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const todoList = orderedTodos(details.todos);
			switch (details.action) {
				case "list": {
					if (todoList.length === 0) {
						return new Text(theme.fg("dim", "No todos"), 0, 0);
					}
					let listText = theme.fg("muted", `${todoList.length} todo(s):`);
					const display = expanded ? todoList : todoList.slice(0, 5);
					for (const t of display) {
						const check = t.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
						const itemText = t.done ? theme.fg("dim", t.text) : theme.fg("muted", t.text);
						listText += `\n${check} ${theme.fg("accent", `#${t.id}`)} ${itemText}`;
					}
					if (!expanded && todoList.length > 5) {
						listText += `\n${theme.fg("dim", `... ${todoList.length - 5} more`)}`;
					}
					return new Text(listText, 0, 0);
				}
				case "add": {
					const added = todoList.reduce((latest, todo) => (todo.id > latest.id ? todo : latest), todoList[0]);
					return new Text(
						theme.fg("success", "✓ Added ") +
							theme.fg("accent", `#${added.id}`) +
							" " +
							theme.fg("muted", added.text),
						0,
						0,
					);
				}
				case "update":
				case "toggle":
				case "remove": {
					const text = result.content[0];
					const msg = text?.type === "text" ? text.text : "";
					return new Text(theme.fg("success", "✓ ") + theme.fg("muted", msg), 0, 0);
				}
				case "clear":
					return new Text(theme.fg("success", "✓ ") + theme.fg("muted", "Cleared all todos"), 0, 0);
			}
		},
	});

	pi.registerCommand("todos", {
		description: "Show all todos on the current branch",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TodoListComponent(todos, theme, () => done());
			});
		},
	});
}
