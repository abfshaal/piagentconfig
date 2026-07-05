/**
 * Destructive git guard — interactive friction, NOT a security boundary.
 *
 * Two strategies: (1) tokenizer walk of git invocations, including payloads of
 * `bash|sh|zsh|ksh|dash -c '...'` and `eval` (recursed), and git invoked via a
 * path (`/usr/bin/git`) or via `env`/`command`/`nohup`/`xargs` prefixes (the
 * token scan sees the `git` token anywhere); (2) raw regex backstop over the
 * whole command string, which also matches inside quoted payloads.
 *
 * Known bypasses (accepted): variable indirection (`G=git; $G reset --hard`),
 * mid-word quote splitting (`git re"set"`), encoded payloads, git calls inside
 * script files. A determined agent can get around this; its job is to stop
 * accidental destruction, not adversaries.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type Match = {
	reason: string;
	command: string;
};

function tokenize(command: string): string[] {
	return (
		command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g)?.map((token) => {
			const trimmed = token.trim();
			if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
				return trimmed.slice(1, -1);
			}
			return trimmed;
		}) ?? []
	);
}

function nextGitSubcommand(tokens: string[], gitIndex: number): { subcommand: string; args: string[] } | undefined {
	let i = gitIndex + 1;

	while (i < tokens.length) {
		const token = tokens[i];
		if (!token) return undefined;
		if (["&&", "||", ";", "|"].includes(token)) return undefined;

		if (["-C", "--git-dir", "--work-tree", "--namespace", "-c"].includes(token)) {
			i += 2;
			continue;
		}

		if (
			token.startsWith("--git-dir=") ||
			token.startsWith("--work-tree=") ||
			token.startsWith("--namespace=") ||
			(token.startsWith("-c") && token.length > 2)
		) {
			i += 1;
			continue;
		}

		if (["--no-pager", "--paginate", "--version", "--help"].includes(token)) {
			i += 1;
			continue;
		}

		return { subcommand: token, args: tokens.slice(i + 1) };
	}

	return undefined;
}

function hasShortFlag(args: string[], flag: string): boolean {
	return args.some((arg) => arg.startsWith("-") && !arg.startsWith("--") && arg.slice(1).includes(flag));
}

function hasAny(args: string[], values: string[]): boolean {
	return args.some((arg) => values.includes(arg));
}

function hasLongFlag(args: string[], flag: string): boolean {
	return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function hasPathAfterDoubleDash(args: string[]): boolean {
	const index = args.indexOf("--");
	return index >= 0 && args.slice(index + 1).some((arg) => arg && !["&&", "||", ";", "|"].includes(arg));
}

function anyTrackedPath(cwd: string, args: string[]): boolean {
	if (args.length === 0) return false;
	try {
		const out = execFileSync("git", ["ls-files", "--", ...args.slice(0, 32)], {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1000,
		});
		return out.toString().trim().length > 0;
	} catch {
		return false;
	}
}

function hasCheckoutForce(args: string[]): boolean {
	return hasShortFlag(args, "f") || hasAny(args, ["--force"]);
}

function looksLikeCheckoutPathspec(arg: string, cwd: string): boolean {
	if (!arg || arg.startsWith("-")) return false;
	if (["&&", "||", ";", "|"].includes(arg)) return false;
	if (arg === "." || arg === ".." || arg.startsWith("./") || arg.startsWith("../")) return true;
	if (arg.includes("/")) return true;
	return existsSync(resolve(cwd, arg));
}

function hasCheckoutPathspec(args: string[], cwd: string): boolean {
	if (hasPathAfterDoubleDash(args)) return true;
	const candidates = args.filter((arg) => arg !== "--" && !arg.startsWith("-"));
	if (candidates.some((arg) => looksLikeCheckoutPathspec(arg, cwd))) return true;
	// One batched git call for the remaining bare-word candidates (branch names vs tracked files).
	const bareWords = candidates.filter(
		(arg) => !looksLikeCheckoutPathspec(arg, cwd) && !["&&", "||", ";", "|"].includes(arg),
	);
	return anyTrackedPath(cwd, bareWords);
}

function hasRestoreWorktreeTarget(args: string[]): boolean {
	if (args.length === 0) return false;
	const stagedOnly = args.includes("--staged") && !args.includes("--worktree") && !args.some((arg) => arg.startsWith("--source"));
	if (stagedOnly) return false;
	return args.some((arg) => !arg.startsWith("-") || arg === "--worktree" || arg.startsWith("--source"));
}

function cleanDeletesFiles(args: string[]): boolean {
	return hasShortFlag(args, "f") || hasAny(args, ["--force"]);
}

function branchForceDelete(args: string[]): boolean {
	return hasShortFlag(args, "D") || ((hasShortFlag(args, "d") || hasAny(args, ["--delete"])) && (hasShortFlag(args, "f") || hasAny(args, ["--force"])));
}

function pushDeletesRemote(args: string[]): boolean {
	return hasLongFlag(args, "--delete") || hasShortFlag(args, "d") || args.some((arg) => /^:[^\s:]+/.test(arg));
}

function switchDiscardsChanges(args: string[]): boolean {
	return hasShortFlag(args, "f") || hasAny(args, ["--force", "--discard-changes"]);
}

function stashDestroysState(args: string[]): boolean {
	return args.some((arg) => ["drop", "clear", "pop"].includes(arg));
}

function matchGitInvocation(subcommand: string, args: string[], cwd: string): string | undefined {
	switch (subcommand) {
		case "reset":
			if (hasAny(args, ["--hard", "--merge", "--keep"])) return "git reset can discard working tree/index changes";
			return undefined;
		case "clean":
			if (cleanDeletesFiles(args)) return "git clean with force deletes untracked files/directories";
			return undefined;
		case "checkout":
			if (hasCheckoutForce(args)) return "git checkout -f/--force discards local changes";
			if (hasCheckoutPathspec(args, cwd)) return "git checkout pathspec can discard working tree changes";
			return undefined;
		case "switch":
			if (switchDiscardsChanges(args)) return "git switch force/discard-changes can discard local changes";
			return undefined;
		case "restore":
			if (hasRestoreWorktreeTarget(args)) return "git restore can discard working tree changes";
			return undefined;
		case "rm":
			return "git rm removes tracked files or stages tracked-file removal";
		case "branch":
			if (branchForceDelete(args)) return "git branch force-delete deletes a branch";
			return undefined;
		case "push":
			if (hasLongFlag(args, "--force") || hasLongFlag(args, "--force-with-lease") || hasAny(args, ["--mirror"]) || hasShortFlag(args, "f")) {
				return "force/mirror push rewrites or deletes remote branch history";
			}
			if (pushDeletesRemote(args)) return "git push delete refspec deletes remote branches/tags";
			return undefined;
		case "rebase":
			return "git rebase rewrites history or changes in-progress history state";
		case "commit":
			if (hasAny(args, ["--amend"])) return "git commit --amend rewrites the previous commit";
			return undefined;
		case "stash":
			if (stashDestroysState(args)) return "git stash drop/clear/pop can destroy or consume saved work";
			return undefined;
		case "cherry-pick":
			if (hasAny(args, ["--abort"])) return "cherry-pick --abort discards an in-progress cherry-pick state";
			return undefined;
		case "merge":
			if (hasAny(args, ["--abort"])) return "merge --abort discards an in-progress merge state";
			return undefined;
		default:
			return undefined;
	}
}

function rawPatternMatch(command: string): string | undefined {
	const patterns: Array<[RegExp, string]> = [
		[/\bgit\b[^\n;&|]*\breset\b[^\n;&|]*(?:--hard\b|--merge\b|--keep\b)/, "git reset can discard working tree/index changes"],
		[/\bgit\b[^\n;&|]*\bclean\b[^\n;&|]*\s-(?:[^\s;&|]*f|[^\s;&|]*f[^\s;&|]*)/, "git clean with force deletes untracked files/directories"],
		[/\bgit\b[^\n;&|]*\bcheckout\b[^\n;&|]*(?:\s--\s+\S+|\s-f\b|\s--force\b)/, "git checkout pathspec/force can discard local changes"],
		[/\bgit\b[^\n;&|]*\bswitch\b[^\n;&|]*(?:\s-f\b|--force\b|--discard-changes\b)/, "git switch force/discard-changes can discard local changes"],
		[/\bgit\b[^\n;&|]*\brm\b/, "git rm removes tracked files or stages tracked-file removal"],
		[/\bgit\b[^\n;&|]*\bbranch\b[^\n;&|]*(?:\s-[A-Za-z]*D[A-Za-z]*\b|\s-[A-Za-z]*d[A-Za-z]*f[A-Za-z]*\b|\s-[A-Za-z]*f[A-Za-z]*d[A-Za-z]*\b|(?:\s-d\b|--delete\b)[^\n;&|]*(?:\s-f\b|--force\b))/, "git branch force-delete deletes a branch"],
		[/\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*(?:--force(?:=|\b)|--force-with-lease(?:=|\b)|--mirror\b|\s-f\b)/, "force/mirror push rewrites or deletes remote branch history"],
		[/\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*(?:--delete(?:=|\b)|\s-d\b|\s:[^\s;&|]+)/, "git push delete refspec deletes remote branches/tags"],
		[/\bgit\b[^\n;&|]*\brebase\b/, "git rebase rewrites history or changes in-progress history state"],
		[/\bgit\b[^\n;&|]*\bcommit\b[^\n;&|]*--amend\b/, "git commit --amend rewrites the previous commit"],
		[/\bgit\b[^\n;&|]*\bstash\b[^\n;&|]*\b(?:drop|clear|pop)\b/, "git stash drop/clear/pop can destroy or consume saved work"],
		[/\bgit\b[^\n;&|]*\bcherry-pick\b[^\n;&|]*--abort\b/, "cherry-pick --abort discards an in-progress cherry-pick state"],
		[/\bgit\b[^\n;&|]*\bmerge\b[^\n;&|]*--abort\b/, "merge --abort discards an in-progress merge state"],
	];

	for (const [pattern, reason] of patterns) {
		if (pattern.test(command)) return reason;
	}

	const restorePattern = /\bgit\b[^\n;&|]*\brestore\b([^\n;&|]*)/g;
	for (const match of command.matchAll(restorePattern)) {
		const args = match[1] ?? "";
		const stagedOnly = /(?:^|\s)--staged(?:\s|$)/.test(args) && !/(?:^|\s)--worktree(?:\s|$)|(?:^|\s)--source(?:=|\s)/.test(args);
		if (stagedOnly) continue;
		if (/(?:^|\s)--source(?:=|\s)|(?:^|\s)--worktree(?:\s|$)|(?:^|\s)--\s+\S+|(?:^|\s)[^\s-]\S*/.test(args)) {
			return "git restore can discard working tree changes";
		}
	}

	return undefined;
}

const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "ksh", "dash"]);

function isGitToken(token: string | undefined): boolean {
	if (!token) return false;
	return token === "git" || /(^|\/)git$/.test(token);
}

function findDestructiveGit(command: string, cwd: string, depth = 0): Match | undefined {
	if (depth > 3) return undefined;
	const tokens = tokenize(command);
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		// Recurse into `bash -c '<payload>'` and friends; tokenize() already unquoted the payload.
		if (token && SHELL_WRAPPERS.has(token.replace(/^.*\//, ""))) {
			const cIndex = tokens.slice(i + 1).findIndex((t) => t === "-c" || ["&&", "||", ";", "|"].includes(t ?? ""));
			const abs = cIndex >= 0 ? i + 1 + cIndex : -1;
			if (abs >= 0 && tokens[abs] === "-c") {
				const payload = tokens.slice(abs + 1).find((t) => t && !t.startsWith("-"));
				if (payload) {
					const inner = findDestructiveGit(payload, cwd, depth + 1);
					if (inner) return { reason: inner.reason, command };
				}
			}
		}

		// Recurse into `eval ...` (payload may be one quoted token or the joined rest).
		if (token === "eval") {
			const rest = tokens.slice(i + 1).join(" ");
			if (rest) {
				const inner = findDestructiveGit(rest, cwd, depth + 1);
				if (inner) return { reason: inner.reason, command };
			}
		}

		if (!isGitToken(token)) continue;
		const invocation = nextGitSubcommand(tokens, i);
		if (!invocation) continue;
		const reason = matchGitInvocation(invocation.subcommand, invocation.args, cwd);
		if (reason) return { reason, command };
	}

	const reason = rawPatternMatch(command);
	if (reason) return { reason, command };

	return undefined;
}

export default function destructiveGitGuard(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const input = event.input as { command?: unknown };
		const command = input.command;
		if (typeof command !== "string") return;

		const match = findDestructiveGit(command, ctx.cwd ?? process.cwd());
		if (!match) return;

		const message = `${match.reason}\n\nCommand:\n${match.command}\n\nAllow this destructive git operation?`;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked destructive git operation: ${match.reason}. Interactive approval unavailable.`,
			};
		}

		const ok = await ctx.ui.confirm("Destructive git operation", message);
		if (!ok) {
			return {
				block: true,
				reason: `Blocked destructive git operation: ${match.reason}`,
			};
		}

		ctx.ui.notify("Allowed destructive git operation for this tool call.", "warning");
	});
}
