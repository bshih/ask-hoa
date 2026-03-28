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

/**
 * Replace 【x:y†source】 markers with [Document Name] using the file map.
 * Falls back to stripping the marker if the file ID isn't found.
 */
function resolveAnnotations(
  text: string,
  annotations: OpenAI.Beta.Threads.Messages.Annotation[],
  fileMap: Record<string, string>
): string {
  let result = text;
  for (const ann of annotations) {
    if (ann.type === 'file_citation') {
      const name = fileMap[ann.file_citation.file_id] ?? 'source';
      result = result.replace(ann.text, ` [${name}]`);
    }
  }
  // Strip any remaining unresolved markers
  return result.replace(/【\d+:\d+†[^】]*】/g, '');
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

  const stream = await openai.beta.threads.runs.stream(activeThread.id, {
    assistant_id: ASSISTANT_ID,
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
        for await (const event of stream) {
          if (event.event === 'thread.message.delta' && event.data.delta.content) {
            for (const part of event.data.delta.content) {
              if (part.type === 'text' && part.text?.value) {
                const annotations = (part.text.annotations ?? []) as OpenAI.Beta.Threads.Messages.Annotation[];
                const text = resolveAnnotations(part.text.value, annotations, fileMap);
                if (text) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'delta', text })}\n\n`
                    )
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

          if (
            event.event === 'thread.run.completed' ||
            event.event === 'thread.run.failed'
          ) {
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
