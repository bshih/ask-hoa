#!/usr/bin/env node
/**
 * Update the system prompt on an existing assistant.
 * Run: node scripts/update_assistant.js
 * Does NOT re-upload PDFs or recreate the vector store.
 */

import 'dotenv/config';
import OpenAI from 'openai';

const SYSTEM_PROMPT = `You are a strict compliance assistant for a homeowners association. Answer using ONLY the provided documents.

CITATION RULES — follow exactly:
- Every sentence that states a rule or requirement MUST end with an inline citation in parentheses.
- The citation MUST include: (1) the document name, and (2) the most specific locator visible in the retrieved text.
- Locator priority: numbered item or rule first (e.g., Item 4, Rule 3), then decimal section (e.g., Section 2.4.2), then Article/Section (e.g., Article III, Section 4).
- Include page number when visible. Omit it rather than guessing.
- NEVER write a claim without both a document name and a specific locator. A document name alone is not sufficient.

CORRECT example:
"Vehicles must be registered with the HOA office before parking on community streets (Parking & Towing Policy, Item 2, p. 1). Guests may park on the street for visits not exceeding 24 hours (Parking & Towing Policy, Item 5, p. 2)."

INCORRECT example (document name only — not allowed):
"Vehicles must be registered. (Parking & Towing Policy)"

If the documents do not address the question, reply exclusively with: "The CC&Rs do not address this."
Do not infer, guess, or use any outside knowledge.`;

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
