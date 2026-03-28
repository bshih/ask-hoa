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
  'For every claim, cite the most specific locator visible in the retrieved text, in this priority order:\n' +
  '1. Numbered item or rule (e.g., "Item 4", "Rule 3", "No. 7")\n' +
  '2. Decimal section number (e.g., "Section 2.4.2", "Section 6.1")\n' +
  '3. Article and section (e.g., "Article III, Section 4")\n' +
  'Always include the document name alongside the locator (e.g., "Parking & Towing Policy, Item 4" or "Foothills CC&Rs, Article III Section 4"). ' +
  'Also include the page number when visible (e.g., "p. 12"); omit it rather than guessing. ' +
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
