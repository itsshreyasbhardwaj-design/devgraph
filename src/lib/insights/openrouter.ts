import type { AnalysisResult, InsightSection, InsightTopic } from '@/lib/core/types';
import { serverEnv } from '@/lib/config/env';
import { buildAnalysisDigest, citablePaths } from './context';

/**
 * OpenRouter insight generation.
 *
 * The model is given a factual digest of the analysis and asked to *explain*
 * it — never to invent facts. Two guarantees hold regardless of what the model
 * returns:
 *
 * 1. If no key is configured, or the call fails for any reason, the caller
 *    keeps the deterministic sections. AI is an enhancement, never a dependency.
 * 2. File references are verified against the real file list before being
 *    surfaced, so a hallucinated path can never become a broken link.
 */

const SYSTEM_PROMPT = `You are a distinguished software architect writing a briefing for an engineer who has just been handed an unfamiliar codebase.

You will be given a factual digest of a static analysis. Every number, path, and name in it is real and machine-verified.

Rules:
- Explain what the structure MEANS and what to do about it. Do not restate numbers the reader can already see.
- Reference concrete files using inline backticks around the exact path from the digest. Never invent a path.
- Be specific and concrete. "Extract the shared Order type into src/types so both services import it instead of each other" beats "consider refactoring".
- Where the analysis is ambiguous, say so plainly rather than guessing confidently.
- No preamble, no summary of your instructions, no "as an AI". Start with the content.
- Write in Markdown. Use short paragraphs and bullet lists. Do not use headings above level 3.
- Be direct and useful. An experienced engineer is reading this; do not pad.`;

const TOPIC_PROMPTS: Record<InsightTopic, string> = {
  overview: 'Explain the overall architecture: what kind of system this is, how it is organised, and the two or three things a new engineer most needs to understand before changing anything.',
  modules: 'Explain the module structure. Which boundaries are working, which are not, and what the cohesion and instability numbers imply about where change is safe.',
  'entry-points': 'Explain where execution begins and the order in which a newcomer should read these files to build an accurate mental model.',
  'auth-flow': 'Explain the authentication and authorisation flow end to end: where identity is established, where it is enforced, and any gap between those two points.',
  'api-lifecycle': 'Explain the life of a request through this API: routing, middleware, handler, persistence, response. Call out anything inconsistent across endpoints.',
  'data-flow': 'Explain how data moves through the system, from external input to persistence and back, and how well isolated the persistence layer is.',
  'state-management': 'Explain how client-side state is managed, what belongs where, and where the current approach will strain as the app grows.',
  dependencies: 'Explain the dependency structure: internal hubs, external surface, coupling risk, and anything that should be broken up or removed.',
  performance: 'Explain the structural performance risks visible in this analysis and which are worth profiling first. Be explicit that these are signals, not measurements.',
  'technical-debt': 'Explain the technical debt: what is actually costly, what is cosmetic, and in what order it should be addressed.',
  improvements: 'Give a prioritised, concrete improvement plan. For each item: what to change, which files, why it matters, and rough effort.',
};

export interface StreamInsightOptions {
  result: AnalysisResult;
  topic: InsightTopic;
  /** Caller-supplied key takes precedence over the server key. */
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
  referer?: string;
}

export class InsightUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: 'no-key' | 'upstream' | 'rate-limited' | 'invalid-key',
  ) {
    super(message);
    this.name = 'InsightUnavailableError';
  }
}

interface OpenRouterChunk {
  choices?: { delta?: { content?: string } }[];
}

/**
 * Stream one insight topic as plain text chunks.
 *
 * Yields deltas so the UI can render tokens as they arrive rather than waiting
 * for the full section.
 */
export async function* streamInsight(options: StreamInsightOptions): AsyncGenerator<string> {
  const env = serverEnv();
  const apiKey = options.apiKey ?? env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new InsightUnavailableError(
      'No OpenRouter API key is configured. DevGraph is showing its deterministic analysis instead.',
      'no-key',
    );
  }

  const model = options.model ?? env.OPENROUTER_MODEL;
  const digest = buildAnalysisDigest(options.result, { topic: options.topic });

  const userPrompt = [
    TOPIC_PROMPTS[options.topic],
    '',
    'Here is the verified analysis digest:',
    '',
    digest,
  ].join('\n');

  let response: Response;
  try {
    response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': options.referer ?? 'https://github.com/itsshreyasbhardwaj-design/devgraph',
        'X-Title': 'DevGraph',
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.2,
        max_tokens: 1600,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new InsightUnavailableError('Could not reach OpenRouter.', 'upstream');
  }

  if (response.status === 401 || response.status === 403) {
    throw new InsightUnavailableError('OpenRouter rejected the API key.', 'invalid-key');
  }
  if (response.status === 429) {
    throw new InsightUnavailableError('OpenRouter rate limit reached.', 'rate-limited');
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new InsightUnavailableError(
      `OpenRouter returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}.`,
      'upstream',
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Server-sent events are newline delimited; a chunk may split a line.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload) as OpenRouterChunk;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Ignore keep-alive comments and malformed frames.
      }
    }
  }
}

/**
 * Turn a completed model response into an `InsightSection`, keeping only file
 * references that exist in the analysed repository.
 */
export function toInsightSection(
  result: AnalysisResult,
  topic: InsightTopic,
  body: string,
  model: string,
): InsightSection {
  const valid = citablePaths(result);
  const references: InsightSection['references'] = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1].trim().replace(/^\.\//, '').split(':')[0];
    if (!valid.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    references.push({ path: candidate });
    if (references.length >= 12) break;
  }

  const fallback = result.insights.sections.find((section) => section.topic === topic);

  return {
    topic,
    title: fallback?.title ?? topic,
    summary: fallback?.summary ?? '',
    body: body.trim(),
    references: references.length ? references : (fallback?.references ?? []),
    confidence: 'medium',
  };
}

export function insightTopics(): InsightTopic[] {
  return Object.keys(TOPIC_PROMPTS) as InsightTopic[];
}

/** Flag `path`-looking backticks the model produced that do not exist. */
export function unverifiedReferences(result: AnalysisResult, body: string): string[] {
  const valid = citablePaths(result);
  const suspicious = new Set<string>();
  for (const match of body.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1].trim().split(':')[0];
    // Only judge things that look like paths, not identifiers or commands.
    if (!candidate.includes('/') || candidate.includes(' ')) continue;
    if (!valid.has(candidate.replace(/^\.\//, ''))) suspicious.add(candidate);
  }
  return [...suspicious];
}
