import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MARKDOWN_HYGIENE_MARKER = "## Markdown Output Hygiene";

const MARKDOWN_HYGIENE = String.raw`
## Markdown Output Hygiene

Use markdown cleanly.

Rules:
- Do not wrap normal prose, explanations, plans, summaries, or lists in fenced code blocks.
- Avoid \`\`\`text fences unless the user explicitly asks for a literal plain-text block.
- Use fenced code blocks only for code, commands, config, logs, diffs, JSON, or exact file contents.
- When using fenced code blocks, prefer specific language tags: ts, tsx, js, json, bash, diff, yaml, markdown.
- For plain examples, use bullets, blockquotes, or inline code instead of \`\`\`text.
`;

export default function markdownHygiene(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		if (event.systemPrompt.includes(MARKDOWN_HYGIENE_MARKER)) {
			return {};
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${MARKDOWN_HYGIENE}`,
		};
	});
}
