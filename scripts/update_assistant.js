#!/usr/bin/env node
/**
 * Update the system prompt on an existing assistant.
 * Run: node scripts/update_assistant.js
 * Does NOT re-upload PDFs or recreate the vector store.
 */

import 'dotenv/config';
import OpenAI from 'openai';

const SYSTEM_PROMPT =
  'You are a strict compliance assistant for a homeowners association. ' +
  'Answer using ONLY the provided documents. ' +
  'For every claim, you MUST cite: (1) the exact document name, (2) the Article and Section number, ' +
  'and (3) the page number (e.g., "Foothills CC&Rs, Article III Section 4, p. 12"). ' +
  'If a page number is not visible in the retrieved text, omit it rather than guessing. ' +
  'If multiple documents are relevant, cite all of them. ' +
  'If the documents do not address the question, reply exclusively with: ' +
  '"The CC&Rs do not address this." ' +
  'Do not infer, guess, or use any outside knowledge.';

async function main() {
  if (!process.env.ASSISTANT_ID) {
    console.error('ASSISTANT_ID not set in .env');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const assistant = await openai.beta.assistants.update(process.env.ASSISTANT_ID, {
    instructions: SYSTEM_PROMPT,
  });

  console.log(`Updated assistant ${assistant.id}`);
  console.log('New instructions set.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
