import { OPENAI_API_KEY, ASSISTANT_ID } from '$env/static/private';
import OpenAI from 'openai';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Lazy-loaded map of fileId → display name, shared across requests
let fileNameMap: Record<string, string> | null = null;

async function getFileNameMap(): Promise<Record<string, string>> {
  if (fileNameMap) return fileNameMap;

  const assistant = await openai.beta.assistants.retrieve(ASSISTANT_ID);
  const vsIds = assistant.tool_resources?.file_search?.vector_store_ids ?? [];

  const map: Record<string, string> = {};
  for (const vsId of vsIds) {
    const files = await openai.vectorStores.files.list(vsId);
    await Promise.all(
      files.data.map(async (f) => {
        const fileObj = await openai.files.retrieve(f.id);
        map[f.id] = fileObj.filename.replace(/\.pdf$/i, '');
      })
    );
  }

  fileNameMap = map;
  return map;
}

// Stopwords to ignore when matching citation text to filenames
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'its']);

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/&/g, '')            // CC&Rs → ccrs (keeps it as one token)
      .replace(/[^a-z0-9\s]/g, ' ') // strip remaining punctuation
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOPWORDS.has(w))
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let count = 0;
  for (const w of a) if (b.has(w)) count++;
  return count / a.size;
}

/**
 * Find inline citations like "(Parking & Towing Policy, Item 1)" and wrap them
 * as markdown links by fuzzy-matching the doc name part to the file map.
 * Annotations from file_search are empty when the model writes explicit inline
 * citations, so we match by keyword overlap instead.
 */
function linkifyInlineCitations(text: string, fileMap: Record<string, string>): string {
  const files = Object.values(fileMap).map((name) => ({
    name,
    href: `/docs/${encodeURIComponent(name)}.pdf`,
    tokens: tokenize(name),
  }));

  function bestMatch(hint: string): { name: string; href: string } | null {
    const tokens = tokenize(hint);
    let best: { name: string; href: string } | null = null;
    let bestScore = 0;
    for (const f of files) {
      const score = overlapScore(tokens, f.tokens);
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best && bestScore >= 0.4 ? best : null;
  }

  // Pass 1: parenthesized citations like (Parking & Towing Policy, Item 1)
  let result = text.replace(/\(([^)]{8,})\)/g, (match, inner) => {
    const docPart = inner.split(',')[0];
    const best = bestMatch(docPart);
    if (best) {
      const rest = inner.slice(docPart.length);
      return `[(${best.name}${rest})](${best.href})`;
    }
    return match;
  });

  // Pass 2: quoted doc names like "Foothills - Bylaws" or 'Foothills - Bylaws'
  // that were NOT already linkified in pass 1
  result = result.replace(/["']([^"']{8,})["']/g, (match, inner, offset) => {
    // Skip if already inside a markdown link (preceded by "[" or "](")
    const before = result.slice(Math.max(0, offset - 2), offset);
    if (before.includes('[') || before.includes('(')) return match;
    const best = bestMatch(inner);
    if (best) {
      return `[${match}](/docs/${encodeURIComponent(best.name)}.pdf)`;
    }
    return match;
  });

  return result;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body?.message || typeof body.message !== 'string') {
    throw error(400, 'Missing message');
  }

  const threadId: string | undefined = body.threadId;

  const [thread, fileMap] = await Promise.all([
    threadId ? openai.beta.threads.retrieve(threadId).catch(() => null) : Promise.resolve(null),
    getFileNameMap(),
  ]);

  const activeThread = thread ?? (await openai.beta.threads.create());

  await openai.beta.threads.messages.create(activeThread.id, {
    role: 'user',
    content: body.message,
  });

  // Ground the model: exact doc names + strict no-hallucination reminder
  const docList = Object.values(fileMap).sort().map(n => `- ${n}`).join('\n');
  const additional_instructions = `Available documents (use EXACT names — do not paraphrase or invent):\n${docList}\n\nCRITICAL: If file_search does not return a passage that directly answers the question, respond ONLY with "The governing documents do not address this topic." Never fill in answers from general HOA knowledge or common rules.\n\nCITATION FORMAT REMINDER: Every answer — including yes/no answers, direct facts, and follow-up questions about sources — MUST include at least one inline citation per claim in the exact format: (Document Name, locator). Example: (Foothills - Bylaws, Article IV, Section 2). Never reference a document by name without wrapping it in this parenthesized format. When using bullet points or numbered lists, EACH bullet/item must end with its own citation — do NOT share a single citation across multiple bullets.`;

  const stream = await openai.beta.threads.runs.stream(activeThread.id, {
    assistant_id: ASSISTANT_ID,
    additional_instructions,
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'thread', threadId: activeThread.id })}\n\n`
        )
      );

      try {
        let completedRunId: string | null = null;

        for await (const event of stream) {
          // Stream raw text deltas for the typing effect.
          // Annotations are incomplete during streaming, so strip markers here
          // and send the fully-resolved text via a `replace` event on completion.
          if (event.event === 'thread.message.delta' && event.data.delta.content) {
            for (const part of event.data.delta.content) {
              if (part.type === 'text' && part.text?.value) {
                const raw = part.text.value.replace(/【\d+:\d+†[^】]*】/g, '');
                if (raw) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: raw })}\n\n`)
                  );
                }
              }
            }
          }

          if (event.event === 'thread.run.failed') {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Run failed. Please try again.' })}\n\n`
              )
            );
          }

          if (event.event === 'thread.run.completed') {
            completedRunId = event.data.id;
          }

          if (
            event.event === 'thread.run.completed' ||
            event.event === 'thread.run.failed'
          ) {
            if (completedRunId) {
              // Fetch the final message and linkify inline citations
              const messages = await openai.beta.threads.messages.list(activeThread.id, {
                limit: 1,
                order: 'desc',
              });
              const finalMsg = messages.data[0];
              let finalText = '';
              for (const block of finalMsg?.content ?? []) {
                if (block.type === 'text') {
                  const clean = block.text.value.replace(/【\d+:\d+†[^】]*】/g, '');
                  finalText += linkifyInlineCitations(clean, fileMap);
                }
              }
              // Warn if a substantive response has no inline citations
              const isSubstantive = finalText.length > 150 &&
                !finalText.includes('governing documents do not address');
              const hasCitation = /\([^)]*,[^)]{2,}\)/.test(finalText);
              if (isSubstantive && !hasCitation) {
                finalText += '\n\n---\n*⚠️ Source citations are missing from this response. Please verify all claims against your HOA governing documents.*';
              }

              if (finalText) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'replace', text: finalText })}\n\n`)
                );
              }
            }

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
            );
            controller.close();
            return;
          }
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'Stream error.' })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
