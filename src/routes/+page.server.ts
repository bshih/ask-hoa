import { OPENAI_API_KEY, ASSISTANT_ID } from '$env/static/private';
import OpenAI from 'openai';
import type { PageServerLoad } from './$types';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export const load: PageServerLoad = async () => {
  try {
    const assistant = await openai.beta.assistants.retrieve(ASSISTANT_ID);
    const vsIds = assistant.tool_resources?.file_search?.vector_store_ids ?? [];

    const sources: { name: string; href: string }[] = [];
    for (const vsId of vsIds) {
      const files = await openai.vectorStores.files.list(vsId);
      await Promise.all(
        files.data.map(async (f) => {
          const fileObj = await openai.files.retrieve(f.id);
          const name = fileObj.filename.replace(/\.pdf$/i, '');
          sources.push({ name, href: `/docs/${encodeURIComponent(name)}.pdf` });
        })
      );
    }

    sources.sort((a, b) => a.name.localeCompare(b.name));
    return { sources };
  } catch {
    return { sources: [] };
  }
};
