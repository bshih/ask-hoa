<script lang="ts">
  import { tick } from 'svelte';
  import { marked } from 'marked';

  marked.use({
    breaks: true,
    renderer: {
      link({ href, text }) {
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
    }
  });

  type Message = {
    role: 'user' | 'assistant';
    text: string;
    pending?: boolean;
  };

  let messages: Message[] = $state([]);
  let input = $state('');
  let threadId = $state<string | undefined>(undefined);
  let loading = $state(false);
  let bottomEl = $state<HTMLElement | undefined>(undefined);

  async function scrollToBottom() {
    await tick();
    bottomEl?.scrollIntoView({ behavior: 'smooth' });
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input = '';
    loading = true;

    messages.push({ role: 'user', text });
    messages.push({ role: 'assistant', text: '', pending: true });
    await scrollToBottom();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = JSON.parse(line.slice(6));

          if (payload.type === 'thread') {
            threadId = payload.threadId;
          } else if (payload.type === 'delta') {
            const last = messages[messages.length - 1];
            if (last?.role === 'assistant') {
              last.text += payload.text;
              messages = messages; // trigger reactivity
              await scrollToBottom();
            }
          } else if (payload.type === 'replace') {
            const last = messages[messages.length - 1];
            if (last?.role === 'assistant') {
              last.text = payload.text;
              messages = messages;
              await scrollToBottom();
            }
          } else if (payload.type === 'error') {
            const last = messages[messages.length - 1];
            if (last?.role === 'assistant') {
              last.text = payload.message;
              last.pending = false;
              messages = messages;
            }
          } else if (payload.type === 'done') {
            const last = messages[messages.length - 1];
            if (last?.role === 'assistant') last.pending = false;
            messages = messages;
          }
        }
      }
    } catch (e) {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        last.text = 'Something went wrong. Please try again.';
        last.pending = false;
        messages = messages;
      }
    } finally {
      loading = false;
      await scrollToBottom();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<svelte:head>
  <title>Ask Your HOA</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Serif+Display&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <h1>Ask Your HOA</h1>
    <p class="subtitle">Ask anything about what's allowed in our community — answers cite the CC&Rs directly.</p>
  </header>

  <div class="chat-window">
    {#if messages.length === 0}
      <div class="empty-state">
        <p>Try asking:</p>
        <ul>
          <li>"Can I paint my front door a different color?"</li>
          <li>"Are short-term rentals like Airbnb allowed?"</li>
          <li>"What are the rules about parking in the driveway?"</li>
          <li>"How many pets am I allowed to have?"</li>
        </ul>
      </div>
    {/if}

    {#each messages as msg}
      <div class="message {msg.role}" class:pending={msg.pending}>
        <div class="bubble">
          {#if msg.pending && !msg.text}
            <span class="typing">
              <span></span><span></span><span></span>
            </span>
          {:else if msg.role === 'assistant'}
            <div class="md">{@html marked.parse(msg.text)}</div>
          {:else}
            {msg.text}
          {/if}
        </div>
      </div>
    {/each}

    <div bind:this={bottomEl}></div>
  </div>

  <form class="input-row" onsubmit={(e) => { e.preventDefault(); send(); }}>
    <textarea
      bind:value={input}
      onkeydown={handleKeydown}
      placeholder="Ask about the CC&Rs…"
      rows={1}
      disabled={loading}
    ></textarea>
    <button type="submit" disabled={loading || !input.trim()}>
      {loading ? '…' : 'Ask'}
    </button>
  </form>
</main>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: 'DM Sans', sans-serif;
    background: #f5f0e8;
    color: #1a1a1a;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  main {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    height: 100dvh;
    gap: 1.25rem;
  }

  header {
    flex-shrink: 0;
  }

  h1 {
    font-family: 'DM Serif Display', serif;
    font-size: 2rem;
    color: #2c5f2e;
    line-height: 1.1;
  }

  .subtitle {
    margin-top: 0.4rem;
    font-size: 0.9rem;
    color: #6b6860;
    max-width: 44ch;
  }

  .chat-window {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: #fffdf8;
    border: 1px solid #e0d9cc;
    border-radius: 12px;
    scroll-behavior: smooth;
  }

  .empty-state {
    margin: auto;
    text-align: left;
    color: #8a8476;
    font-size: 0.9rem;
  }

  .empty-state p {
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #5a5650;
  }

  .empty-state ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .empty-state li::before {
    content: '→ ';
    color: #2c5f2e;
  }

  .message {
    display: flex;
  }

  .message.user {
    justify-content: flex-end;
  }

  .message.assistant {
    justify-content: flex-start;
  }

  .bubble {
    max-width: 80%;
    padding: 0.7rem 1rem;
    border-radius: 16px;
    font-size: 0.95rem;
    line-height: 1.55;
  }

  /* Markdown content inside assistant bubbles */
  .bubble .md :global(p) { margin: 0 0 0.6em; }
  .bubble .md :global(p:last-child) { margin-bottom: 0; }
  .bubble .md :global(strong) { font-weight: 600; }
  .bubble .md :global(em) { font-style: italic; }
  .bubble .md :global(ul),
  .bubble .md :global(ol) {
    padding-left: 1.4em;
    margin: 0.4em 0 0.6em;
    display: flex;
    flex-direction: column;
    gap: 0.25em;
  }
  .bubble .md :global(li) { line-height: 1.5; }

  /* Citation links — styled as small document badges */
  .bubble .md :global(a) {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    font-size: 0.78rem;
    font-weight: 500;
    color: #2c5f2e;
    background: #dff0df;
    border: 1px solid #b5d9b6;
    border-radius: 4px;
    padding: 0.1em 0.45em;
    text-decoration: none;
    white-space: nowrap;
    vertical-align: middle;
    transition: background 0.12s;
  }
  .bubble .md :global(a::before) {
    content: '📄';
    font-size: 0.75em;
  }
  .bubble .md :global(a:hover) {
    background: #c8e6c9;
  }

  .message.user .bubble {
    background: #2c5f2e;
    color: #fff;
    border-bottom-right-radius: 4px;
  }

  .message.assistant .bubble {
    background: #ede8df;
    color: #1a1a1a;
    border-bottom-left-radius: 4px;
  }

  .typing {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    height: 1.2em;
  }

  .typing span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8a8476;
    animation: bounce 1.2s infinite;
  }

  .typing span:nth-child(2) { animation-delay: 0.2s; }
  .typing span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
  }

  .input-row {
    flex-shrink: 0;
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  textarea {
    flex: 1;
    resize: none;
    padding: 0.75rem 1rem;
    border: 1px solid #cfc8bb;
    border-radius: 10px;
    background: #fff;
    font-family: inherit;
    font-size: 0.95rem;
    color: #1a1a1a;
    outline: none;
    transition: border-color 0.15s;
    field-sizing: content;
    max-height: 160px;
    overflow-y: auto;
  }

  textarea:focus {
    border-color: #2c5f2e;
  }

  textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button {
    padding: 0.75rem 1.5rem;
    background: #2c5f2e;
    color: #fff;
    border: none;
    border-radius: 10px;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    white-space: nowrap;
  }

  button:hover:not(:disabled) {
    background: #234d25;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
