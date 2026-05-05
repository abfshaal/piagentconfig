import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

const SEARCH_PROVIDERS = ["auto", "ddg_html", "ddg_api", "wikipedia", "brave", "searxng", "serpapi"] as const;
const USER_AGENT = "Mozilla/5.0 (compatible; PiWebTools/2.0; +https://pi.dev)";
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 10;
const DEFAULT_FETCH_MAX_CHARS = 8000;
const MIN_FETCH_MAX_CHARS = 500;
const MAX_FETCH_MAX_CHARS = 50000;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PROVIDER_RESPONSE_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_QUERY_LENGTH = 400;

type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

type CacheEntry<T> = {
	expiresAt: number;
	value: T;
};

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	source: string;
}

interface SearchExecutionResult {
	provider: SearchProvider;
	results: SearchResult[];
	cached: boolean;
	attemptedProviders: SearchProvider[];
}

interface TextResponse {
	url: string;
	contentType: string;
	text: string;
	status: number;
	truncated: boolean;
	receivedBytes: number;
	redirectCount: number;
}

interface FetchResultPayload {
	contentText: string;
	details: {
		url: string;
		finalUrl: string;
		status: number;
		contentType: string;
		title: string;
		raw: boolean;
		truncated: boolean;
		receivedBytes: number;
		redirectCount: number;
		cached: boolean;
	};
}

const searchCache = new Map<string, CacheEntry<SearchExecutionResult>>();
const fetchCache = new Map<string, CacheEntry<FetchResultPayload>>();

function now(): number {
	return Date.now();
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	if (entry.expiresAt <= now()) {
		cache.delete(key);
		return undefined;
	}
	return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
	cache.set(key, { value, expiresAt: now() + ttlMs });
}

function pruneExpired(cache: Map<string, CacheEntry<unknown>>) {
	const current = now();
	for (const [key, entry] of cache.entries()) {
		if (entry.expiresAt <= current) cache.delete(key);
	}
}

function decodeHtmlEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const code = Number.parseInt(entity.slice(2), 16);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		if (entity.startsWith("#")) {
			const code = Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}

		const entities: Record<string, string> = {
			amp: "&",
			lt: "<",
			gt: ">",
			quot: '"',
			apos: "'",
			nbsp: " ",
		};
		return entities[entity] ?? match;
	});
}

function collapseWhitespace(input: string): string {
	return input.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function truncate(input: string, maxChars: number): string {
	if (input.length <= maxChars) return input;
	return `${input.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function normalizeQuery(input: string): string {
	const query = collapseWhitespace(input);
	if (!query) throw new Error("query must not be empty");
	if (query.length > MAX_QUERY_LENGTH) {
		throw new Error(`query too long: maximum ${MAX_QUERY_LENGTH} characters`);
	}
	return query;
}

function normalizeLimit(limit?: number): number {
	return Math.min(Math.max(limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
}

function normalizeMaxChars(maxChars?: number): number {
	return Math.min(Math.max(maxChars ?? DEFAULT_FETCH_MAX_CHARS, MIN_FETCH_MAX_CHARS), MAX_FETCH_MAX_CHARS);
}

function normalizeSearchProvider(input?: SearchProvider): SearchProvider {
	return input ?? "auto";
}

function isTextLikeContentType(contentType: string): boolean {
	const lower = contentType.toLowerCase();
	return (
		lower.startsWith("text/") ||
		lower.includes("json") ||
		lower.includes("xml") ||
		lower.includes("javascript") ||
		lower.includes("x-www-form-urlencoded") ||
		lower.includes("graphql")
	);
}

function isHtmlContentType(contentType: string): boolean {
	const lower = contentType.toLowerCase();
	return lower.includes("text/html") || lower.includes("application/xhtml+xml");
}

function isJsonContentType(contentType: string): boolean {
	return contentType.toLowerCase().includes("json");
}

function normalizeDuckDuckGoUrl(rawHref: string): string {
	const href = decodeHtmlEntities(rawHref);
	const url = new URL(href, "https://duckduckgo.com");
	if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") {
		const target = url.searchParams.get("uddg");
		if (target) return decodeURIComponent(target);
	}
	return url.toString();
}

function stripHtml(input: string): string {
	return collapseWhitespace(
		decodeHtmlEntities(
			input
				.replace(/<!--[\s\S]*?-->/g, " ")
				.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
				.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
				.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
				.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
				.replace(/<(svg|canvas|picture|video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
				.replace(/<(br|\/p|\/div|\/li|\/ul|\/ol|\/h1|\/h2|\/h3|\/h4|\/article|\/section|\/main|\/pre|\/table|\/tr)>/gi, "\n")
				.replace(/<[^>]+>/g, " "),
		),
	);
}

function stripHtmlForMainContent(input: string): string {
	return stripHtml(
		input
			.replace(/<(nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
			.replace(/<(button|label|select|option|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, " "),
	);
}

function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match ? collapseWhitespace(decodeHtmlEntities(match[1])) : "";
}

function extractMetaDescription(html: string): string {
	const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
	return match ? collapseWhitespace(decodeHtmlEntities(match[1])) : "";
}

function htmlToReadableText(html: string, maxChars: number): { title: string; text: string } {
	const title = extractTitle(html);
	const description = extractMetaDescription(html);
	const body = truncate(stripHtmlForMainContent(html), maxChars);
	const parts = [description, body].filter(Boolean);
	const text = collapseWhitespace(parts.join("\n\n"));
	return {
		title,
		text: text || truncate(stripHtml(html), maxChars),
	};
}

function isPrivateIpAddress(ip: string): boolean {
	const lower = ip.toLowerCase();
	if (lower === "::" || lower === "::1") return true;
	if (lower.startsWith("::ffff:")) {
		return isPrivateIpAddress(lower.slice("::ffff:".length));
	}

	const version = isIP(ip);
	if (version === 4) {
		const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
		if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
		const [a, b] = parts;
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	if (version === 6) {
		return (
			lower.startsWith("fc") ||
			lower.startsWith("fd") ||
			lower.startsWith("fe80") ||
			lower.startsWith("fec0")
		);
	}
	return true;
}

function isBlockedHostname(hostname: string): boolean {
	const lower = hostname.trim().toLowerCase();
	return (
		lower === "localhost" ||
		lower.endsWith(".localhost") ||
		lower.endsWith(".local") ||
		lower.endsWith(".internal") ||
		lower.endsWith(".home") ||
		lower.endsWith(".lan") ||
		lower.endsWith(".arpa")
	);
}

function normalizePublicUrl(input: string): URL {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error("invalid URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("only http:// and https:// URLs are allowed");
	}
	if (!url.hostname) throw new Error("URL must include a hostname");
	if (url.username || url.password) {
		throw new Error("embedded URL credentials are not allowed");
	}
	return url;
}

async function assertPublicUrlIsSafe(url: URL) {
	const hostname = url.hostname;
	if (isBlockedHostname(hostname)) {
		throw new Error(`blocked private/internal hostname: ${hostname}`);
	}

	if (isIP(hostname)) {
		if (isPrivateIpAddress(hostname)) {
			throw new Error(`blocked private/internal IP: ${hostname}`);
		}
		return;
	}

	let resolved;
	try {
		resolved = await dnsLookup(hostname, { all: true, verbatim: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`DNS lookup failed for ${hostname}: ${message}`);
	}
	if (!resolved.length) {
		throw new Error(`DNS lookup returned no addresses for ${hostname}`);
	}
	for (const entry of resolved) {
		if (isPrivateIpAddress(entry.address)) {
			throw new Error(`blocked private/internal target for ${hostname}: ${entry.address}`);
		}
	}
}

function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
	let onAbort: (() => void) | undefined;

	if (parent) {
		if (parent.aborted) {
			controller.abort(parent.reason);
		} else {
			onAbort = () => controller.abort(parent.reason);
			parent.addEventListener("abort", onAbort, { once: true });
		}
	}

	return {
		signal: controller.signal,
		cleanup() {
			clearTimeout(timer);
			if (parent && onAbort) parent.removeEventListener("abort", onAbort);
		},
	};
}

async function readResponseText(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean; receivedBytes: number }> {
	const body = response.body;
	if (!body) {
		return { text: await response.text(), truncated: false, receivedBytes: 0 };
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let truncated = false;
	let receivedBytes = 0;
	let text = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		if (!value) continue;

		receivedBytes += value.byteLength;
		if (receivedBytes > maxBytes) {
			const allowedBytes = value.byteLength - (receivedBytes - maxBytes);
			if (allowedBytes > 0) {
				text += decoder.decode(value.subarray(0, allowedBytes), { stream: true });
			}
			truncated = true;
			try {
				await reader.cancel();
			} catch {
				// Ignore cancellation errors.
			}
			break;
		}

		text += decoder.decode(value, { stream: true });
	}

	text += decoder.decode();
	return { text, truncated, receivedBytes: Math.min(receivedBytes, maxBytes) };
}

async function requestText(
	url: string,
	init: RequestInit = {},
	signal?: AbortSignal,
	options?: { timeoutMs?: number; maxBytes?: number },
): Promise<TextResponse> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = options?.maxBytes ?? PROVIDER_RESPONSE_MAX_BYTES;
	const timeout = createTimeoutSignal(signal, timeoutMs);

	try {
		const response = await fetch(url, {
			...init,
			headers: {
				"user-agent": USER_AGENT,
				"accept-language": "en-US,en;q=0.9",
				...(init.headers ?? {}),
			},
			signal: timeout.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const { text, truncated, receivedBytes } = await readResponseText(response, maxBytes);
		return {
			url: response.url,
			contentType: response.headers.get("content-type") ?? "",
			text,
			status: response.status,
			truncated,
			receivedBytes,
			redirectCount: 0,
		};
	} finally {
		timeout.cleanup();
	}
}

async function requestJson(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<any> {
	const response = await requestText(url, init, signal, { maxBytes: PROVIDER_RESPONSE_MAX_BYTES });
	if (response.truncated) {
		throw new Error(`response from ${url} exceeded ${PROVIDER_RESPONSE_MAX_BYTES} bytes`);
	}
	try {
		return JSON.parse(response.text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`invalid JSON response: ${message}`);
	}
}

function isRedirectStatus(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function requestPublicText(url: string, signal?: AbortSignal): Promise<TextResponse> {
	let currentUrl = normalizePublicUrl(url);
	let redirectCount = 0;

	while (true) {
		await assertPublicUrlIsSafe(currentUrl);
		const timeout = createTimeoutSignal(signal, DEFAULT_TIMEOUT_MS);
		try {
			const response = await fetch(currentUrl.toString(), {
				method: "GET",
				redirect: "manual",
				headers: {
					"user-agent": USER_AGENT,
					"accept-language": "en-US,en;q=0.9",
				},
				signal: timeout.signal,
			});

			if (isRedirectStatus(response.status)) {
				const location = response.headers.get("location");
				if (!location) throw new Error(`redirect without Location header (${response.status})`);
				redirectCount += 1;
				if (redirectCount > MAX_REDIRECTS) {
					throw new Error(`too many redirects (max ${MAX_REDIRECTS})`);
				}
				currentUrl = normalizePublicUrl(new URL(location, currentUrl).toString());
				continue;
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}

			const contentType = response.headers.get("content-type") ?? "";
			const { text, truncated, receivedBytes } = await readResponseText(response, MAX_RESPONSE_BYTES);
			return {
				url: response.url || currentUrl.toString(),
				contentType,
				text,
				status: response.status,
				truncated,
				receivedBytes,
				redirectCount,
			};
		} finally {
			timeout.cleanup();
		}
	}
}

function normalizeSearchResult(result: SearchResult): SearchResult | undefined {
	try {
		const normalizedUrl = new URL(result.url);
		normalizedUrl.hash = "";
		const title = collapseWhitespace(result.title);
		const snippet = truncate(collapseWhitespace(result.snippet), 400);
		const url = normalizedUrl.toString();
		if (!title || !url) return undefined;
		return {
			title,
			url,
			snippet,
			source: result.source,
		};
	} catch {
		return undefined;
	}
}

function dedupeResults(results: SearchResult[], limit: number): SearchResult[] {
	const deduped: SearchResult[] = [];
	const seen = new Set<string>();
	for (const item of results) {
		const normalized = normalizeSearchResult(item);
		if (!normalized) continue;
		const key = normalized.url.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(normalized);
		if (deduped.length >= limit) break;
	}
	return deduped;
}

async function searchDuckDuckGoHtml(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
	const { text } = await requestText(url, {}, signal);
	const chunks = text.split('<div class="result results_links results_links_deep web-result ');
	const results: SearchResult[] = [];

	for (const chunk of chunks.slice(1)) {
		const titleMatch = chunk.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!titleMatch) continue;

		const snippetMatch = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ?? chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//i);
		const title = stripHtml(titleMatch[2]);
		const href = normalizeDuckDuckGoUrl(titleMatch[1]);
		const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

		if (title && href) {
			results.push({ title, url: href, snippet, source: "duckduckgo-html" });
		}
		if (results.length >= limit) break;
	}

	return dedupeResults(results, limit);
}

async function searchDuckDuckGoApi(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const payload = await requestJson(
		`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`,
		{},
		signal,
	);
	const results: SearchResult[] = [];

	if (payload.AbstractURL) {
		results.push({
			title: collapseWhitespace(payload.Heading || query),
			url: payload.AbstractURL,
			snippet: collapseWhitespace(payload.AbstractText || ""),
			source: "duckduckgo-api",
		});
	}

	const walk = (items: any[]) => {
		for (const item of items) {
			if (results.length >= limit) return;
			if (Array.isArray(item.Topics)) {
				walk(item.Topics);
				continue;
			}
			if (!item.FirstURL) continue;
			const text = collapseWhitespace(item.Text || "");
			results.push({
				title: text.split(" - ", 1)[0] || item.FirstURL,
				url: item.FirstURL,
				snippet: text,
				source: "duckduckgo-api",
			});
		}
	};

	walk(payload.RelatedTopics ?? []);
	return dedupeResults(results, limit);
}

async function searchWikipedia(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const payload = await requestJson(
		`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=${Math.min(limit, 20)}`,
		{},
		signal,
	);

	const results = (payload.query?.search ?? []).slice(0, limit).map((item: any) => ({
		title: collapseWhitespace(item.title || ""),
		url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || "").replace(/ /g, "_"))}`,
		snippet: stripHtml(item.snippet || ""),
		source: "wikipedia",
	}));
	return dedupeResults(results, limit);
}

async function searchBrave(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const apiKey = process.env.BRAVE_API_KEY;
	if (!apiKey) throw new Error("BRAVE_API_KEY is not set");

	const payload = await requestJson(
		`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`,
		{
			headers: {
				"x-subscription-token": apiKey,
				accept: "application/json",
			},
		},
		signal,
	);

	const results = (payload.web?.results ?? []).slice(0, limit).map((item: any) => ({
		title: collapseWhitespace(item.title || ""),
		url: item.url || "",
		snippet: collapseWhitespace(item.description || ""),
		source: "brave",
	}));
	return dedupeResults(results, limit);
}

async function searchSearxng(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const baseUrl = process.env.SEARXNG_URL;
	if (!baseUrl) throw new Error("SEARXNG_URL is not set");

	const payload = await requestJson(
		`${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&language=en&safesearch=0`,
		{
			headers: { accept: "application/json" },
		},
		signal,
	);

	const results = (payload.results ?? []).slice(0, limit).map((item: any) => ({
		title: collapseWhitespace(item.title || ""),
		url: item.url || "",
		snippet: collapseWhitespace(item.content || ""),
		source: "searxng",
	}));
	return dedupeResults(results, limit);
}

async function searchSerpapi(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const apiKey = process.env.SERPAPI_API_KEY;
	if (!apiKey) throw new Error("SERPAPI_API_KEY is not set");

	const payload = await requestJson(
		`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&num=${Math.min(limit, 20)}`,
		{
			headers: { accept: "application/json" },
		},
		signal,
	);

	const results = (payload.organic_results ?? []).slice(0, limit).map((item: any) => ({
		title: collapseWhitespace(item.title || ""),
		url: item.link || "",
		snippet: collapseWhitespace(item.snippet || ""),
		source: "serpapi",
	}));
	return dedupeResults(results, limit);
}

async function runProviderSearch(provider: SearchProvider, query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
	if (provider === "ddg_html") return searchDuckDuckGoHtml(query, limit, signal);
	if (provider === "ddg_api") return searchDuckDuckGoApi(query, limit, signal);
	if (provider === "wikipedia") return searchWikipedia(query, limit, signal);
	if (provider === "brave") return searchBrave(query, limit, signal);
	if (provider === "searxng") return searchSearxng(query, limit, signal);
	if (provider === "serpapi") return searchSerpapi(query, limit, signal);
	throw new Error(`unsupported provider: ${provider}`);
}

function autoProviderOrder(): SearchProvider[] {
	const ordered: SearchProvider[] = [];
	if (process.env.BRAVE_API_KEY) ordered.push("brave");
	if (process.env.SEARXNG_URL) ordered.push("searxng");
	ordered.push("ddg_html", "ddg_api", "wikipedia");
	if (process.env.SERPAPI_API_KEY) ordered.push("serpapi");
	return ordered;
}

async function searchInternet(provider: SearchProvider, query: string, limit: number, signal?: AbortSignal): Promise<SearchExecutionResult> {
	pruneExpired(searchCache as Map<string, CacheEntry<unknown>>);
	const cacheKey = JSON.stringify({ provider, query, limit });
	const cached = getCached(searchCache, cacheKey);
	if (cached) {
		return { ...cached, cached: true };
	}

	if (provider !== "auto") {
		const results = await runProviderSearch(provider, query, limit, signal);
		const payload: SearchExecutionResult = {
			provider,
			results,
			cached: false,
			attemptedProviders: [provider],
		};
		setCached(searchCache, cacheKey, payload, SEARCH_CACHE_TTL_MS);
		return payload;
	}

	const attemptedProviders: SearchProvider[] = [];
	let emptyFallback: SearchExecutionResult | undefined;
	let lastError: Error | undefined;

	for (const candidate of autoProviderOrder()) {
		attemptedProviders.push(candidate);
		try {
			const results = await runProviderSearch(candidate, query, limit, signal);
			const payload: SearchExecutionResult = {
				provider: candidate,
				results,
				cached: false,
				attemptedProviders: [...attemptedProviders],
			};
			if (results.length > 0) {
				setCached(searchCache, cacheKey, payload, SEARCH_CACHE_TTL_MS);
				return payload;
			}
			emptyFallback = payload;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
	}

	if (emptyFallback) {
		setCached(searchCache, cacheKey, emptyFallback, SEARCH_CACHE_TTL_MS);
		return emptyFallback;
	}
	if (lastError) throw lastError;
	throw new Error("no search providers available");
}

function formatSearchResults(result: SearchExecutionResult, query: string): string {
	if (result.results.length === 0) {
		return `No results for ${query} using provider ${result.provider}.`;
	}

	const lines = [
		`Search results for: ${query}`,
		`Provider: ${result.provider}${result.cached ? " (cached)" : ""}`,
		result.attemptedProviders.length > 1 ? `Attempted: ${result.attemptedProviders.join(", ")}` : undefined,
		"",
	].filter(Boolean) as string[];

	for (const [index, item] of result.results.entries()) {
		lines.push(`[${index + 1}] ${item.title}`);
		lines.push(`URL: ${item.url}`);
		if (item.snippet) lines.push(`Snippet: ${item.snippet}`);
		lines.push(`Source: ${item.source}`);
		lines.push("");
	}
	return lines.join("\n").trim();
}

function buildFetchResult(response: TextResponse, requestUrl: string, maxChars: number, raw: boolean, cached: boolean): FetchResultPayload {
	const contentType = response.contentType.toLowerCase();
	const looksLikeJson = isJsonContentType(contentType) || /^[\s\n\r]*[\[{]/.test(response.text);
	const looksLikeHtml = isHtmlContentType(contentType) || /<html[\s>]/i.test(response.text.slice(0, 500));
	let body = truncate(response.text, maxChars);
	let title = "";

	if (!raw && looksLikeJson) {
		try {
			body = truncate(JSON.stringify(JSON.parse(response.text), null, 2), maxChars);
		} catch {
			body = truncate(response.text, maxChars);
		}
	} else if (!raw && looksLikeHtml) {
		const extracted = htmlToReadableText(response.text, maxChars);
		title = extracted.title;
		body = extracted.text;
	} else if (!raw && contentType && !isTextLikeContentType(contentType)) {
		throw new Error(`unsupported content-type for readable extraction: ${response.contentType}`);
	}

	const prefix = [
		`URL: ${response.url}`,
		`Status: ${response.status}`,
		`Content-Type: ${response.contentType || "unknown"}`,
		title ? `Title: ${title}` : undefined,
		`Redirects: ${response.redirectCount}`,
		`Cache: ${cached ? "hit" : "miss"}`,
		response.truncated ? `Warning: response truncated at ${MAX_RESPONSE_BYTES} bytes` : undefined,
		body.length >= maxChars ? `Warning: output truncated to ${maxChars} characters` : undefined,
		"",
	].filter(Boolean).join("\n");

	return {
		contentText: `${prefix}\n${body}`.trim(),
		details: {
			url: requestUrl,
			finalUrl: response.url,
			status: response.status,
			contentType: response.contentType,
			title,
			raw,
			truncated: response.truncated || body.length >= maxChars,
			receivedBytes: response.receivedBytes,
			redirectCount: response.redirectCount,
			cached,
		},
	};
}

async function fetchPublicUrl(url: string, maxChars: number, raw: boolean, signal?: AbortSignal): Promise<FetchResultPayload> {
	pruneExpired(fetchCache as Map<string, CacheEntry<unknown>>);
	const cacheKey = JSON.stringify({ url, maxChars, raw });
	const cached = getCached(fetchCache, cacheKey);
	if (cached) {
		return {
			contentText: cached.contentText,
			details: { ...cached.details, cached: true },
		};
	}

	const response = await requestPublicText(url, signal);
	const payload = buildFetchResult(response, url, maxChars, raw, false);
	setCached(fetchCache, cacheKey, payload, FETCH_CACHE_TTL_MS);
	return payload;
}

function availableProvidersSummary(): string {
	const available = ["ddg_html", "ddg_api", "wikipedia"];
	if (process.env.BRAVE_API_KEY) available.push("brave");
	if (process.env.SEARXNG_URL) available.push("searxng");
	if (process.env.SERPAPI_API_KEY) available.push("serpapi");
	return available.join(", ");
}

function supportedProvidersSummary(): string {
	return SEARCH_PROVIDERS.filter((provider) => provider !== "auto").join(", ");
}

export default function webToolsExtension(pi: ExtensionAPI) {
	const fetchToolDefinition = {
		label: "Web Fetch",
		description:
			"Fetch a public HTTP(S) URL and return readable content from HTML, JSON, or text responses. Blocks private/internal targets, re-validates redirects, and caps response size.",
		promptSnippet: "Fetch a specific public URL from the internet and extract readable content.",
		promptGuidelines: [
			"For internet/web research, prefer subagent with mode web so search/fetch work stays isolated; use web_fetch or fetch_url directly only for a specific URL or very small lookup.",
			"Use web_fetch or fetch_url after web_search to inspect source pages directly.",
			"Prefer fetching the original source before making claims about its contents.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "The public http(s) URL to fetch" }),
			maxChars: Type.Optional(Type.Integer({ minimum: MIN_FETCH_MAX_CHARS, maximum: MAX_FETCH_MAX_CHARS, description: "Maximum characters to return" })),
			raw: Type.Optional(Type.Boolean({ description: "Return raw response text instead of readable extraction" })),
		}),
		async execute(_toolCallId: string, params: { url: string; maxChars?: number; raw?: boolean }, signal?: AbortSignal) {
			const maxChars = normalizeMaxChars(params.maxChars);
			const payload = await fetchPublicUrl(params.url, maxChars, Boolean(params.raw), signal);
			return {
				content: [{ type: "text", text: payload.contentText }],
				details: payload.details,
			};
		},
	} as const;

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search public internet sources using DuckDuckGo, Wikipedia, Brave, SearXNG, or SerpAPI. Auto mode prefers configured providers, falls back to public sources, and caches results briefly.",
		promptSnippet: "Search the public internet for current information, references, docs, and websites.",
		promptGuidelines: [
			"When the user asks to search the internet, find recent information, discover sources, or verify current docs, use subagent with mode web automatically instead of asking the user to choose a subagent.",
			"Use web_search directly only for very small lookups where a separate subagent would be unnecessary, or inside a web subagent.",
			"After finding promising URLs, use web_fetch or fetch_url to inspect the actual page content.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			provider: Type.Optional(StringEnum(SEARCH_PROVIDERS, { description: "Search backend to use" })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SEARCH_LIMIT, description: "Maximum number of results to return" })),
		}),
		async execute(_toolCallId, params, signal) {
			const provider = normalizeSearchProvider(params.provider);
			const query = normalizeQuery(params.query);
			const limit = normalizeLimit(params.limit);
			const result = await searchInternet(provider, query, limit, signal);
			return {
				content: [{ type: "text", text: formatSearchResults(result, query) }],
				details: {
					query,
					provider: result.provider,
					requestedProvider: provider,
					cached: result.cached,
					availableProviders: availableProvidersSummary(),
					attemptedProviders: result.attemptedProviders,
					results: result.results,
				},
			};
		},
	});

	pi.registerTool({
		name: "fetch_url",
		...fetchToolDefinition,
	});

	pi.registerTool({
		name: "web_fetch",
		...fetchToolDefinition,
	});

	pi.registerCommand("web-status", {
		description: "Show configured web-search providers and fetch safety rules",
		handler: async (_args, ctx) => {
			pruneExpired(searchCache as Map<string, CacheEntry<unknown>>);
			pruneExpired(fetchCache as Map<string, CacheEntry<unknown>>);
			ctx.ui.notify(
				[
					`Supported web_search providers: ${supportedProvidersSummary()}`,
					`Available now: ${availableProvidersSummary()}`,
					`fetch_url/web_fetch restrictions: public http(s) only, private/internal hosts blocked, redirects re-checked (max ${MAX_REDIRECTS}), response capped at ${MAX_RESPONSE_BYTES} bytes.`,
					`Cache: search ${Math.round(SEARCH_CACHE_TTL_MS / 60000)}m, fetch ${Math.round(FETCH_CACHE_TTL_MS / 60000)}m.`,
					`Live cache entries: search=${searchCache.size}, fetch=${fetchCache.size}`,
				].join("\n"),
				"info",
			);
		},
	});
}
