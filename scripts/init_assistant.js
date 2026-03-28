#!/usr/bin/env node
/**
 * One-time setup: upload CC&R PDF, create vector store + assistant.
 * Run: node scripts/init_assistant.js
 * Output: prints ASSISTANT_ID — copy it into your .env file.
 *
 * Idempotent: if ASSISTANT_ID is already set in env, skips creation.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';

const PDF_PATH = path.resolve('docs/ccr.pdf');
const SYSTEM_PROMPT =
  'You are a strict compliance assistant for a homeowners association. ' +
  'Answer using ONLY the provided CC&R document. ' +
  'Cite the exact Article and Section number for every claim (e.g., "Article III, Section 4"). ' +
  'If the document does not address the question, reply exclusively with: ' +
  '"The CC&Rs do not address this." ' +
  'Do not infer, guess, or use any outside knowledge.';

async function main() {
  if (process.env.ASSISTANT_ID) {
    console.log(`ASSISTANT_ID already set: ${process.env.ASSISTANT_ID}`);
    console.log('Delete it from .env to re-provision.');
    process.exit(0);
  }

  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF not found at ${PDF_PATH}`);
    console.error('Place your CC&R document at docs/ccr.pdf and re-run.');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1. Upload PDF
  console.log('Uploading PDF...');
  const file = await openai.files.create({
    file: fs.createReadStream(PDF_PATH),
    purpose: 'assistants',
  });
  console.log(`  File ID: ${file.id}`);

  // 2. Create vector store and attach file
  console.log('Creating vector store...');
  const vectorStore = await openai.beta.vectorStores.create({
    name: 'HOA CC&Rs',
    file_ids: [file.id],
  });

  // Poll until processing is complete
  let vs = vectorStore;
  while (vs.file_counts.in_progress > 0) {
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000));
    vs = await openai.beta.vectorStores.retrieve(vectorStore.id);
  }
  console.log(`\n  Vector Store ID: ${vs.id} (status: ${vs.status})`);

  if (vs.status !== 'completed') {
    console.error(`Vector store processing failed: ${vs.status}`);
    process.exit(1);
  }

  // 3. Create assistant
  console.log('Creating assistant...');
  const assistant = await openai.beta.assistants.create({
    name: 'HOA CC&R Assistant',
    model: 'gpt-4o-mini',
    instructions: SYSTEM_PROMPT,
    tools: [{ type: 'file_search' }],
    tool_resources: {
      file_search: { vector_store_ids: [vs.id] },
    },
  });

  console.log('\nDone! Add this to your .env file:');
  console.log(`ASSISTANT_ID=${assistant.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
