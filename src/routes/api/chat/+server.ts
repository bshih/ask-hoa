import { OPENAI_API_KEY, ASSISTANT_ID } from '$env/static/private';
import OpenAI from 'openai';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * Strip OpenAI file_search annotation markers like 【4:0†source】
 * before sending text to the client.
 */
function stripAnnotations(text: string): string {
  return text.replace(/【\d+:\d+†[^】]*】/g, '');
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body?.message || typeof body.message !== 'string') {
    throw error(400, 'Missing message');
  }

  // Accept an existing threadId for multi-turn; create fresh if absent
  const threadId: string | undefined = body.threadId;

  const thread = threadId
    ? await openai.beta.threads.retrieve(threadId).catch(() => null)
    : null;

  const activeThread =
    thread ?? (await openai.beta.threads.create());

  await openai.beta.threads.messages.create(activeThread.id, {
    role: 'user',
    content: body.message,
  });

  // Stream the run
  const stream = await openai.beta.threads.runs.stream(activeThread.id, {
    assistant_id: ASSISTANT_ID,
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      // Send the threadId first so the client can persist it
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'thread', threadId: activeThread.id })}\n\n`
        )
      );

      try {
        for await (const event of stream) {
          if (
            event.event === 'thread.message.delta' &&
            event.data.delta.content
          ) {
            for (const part of event.data.delta.content) {
              if (part.type === 'text' && part.text?.value) {
                const clean = stripAnnotations(part.text.value);
                if (clean) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'delta', text: clean })}\n\n`
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
