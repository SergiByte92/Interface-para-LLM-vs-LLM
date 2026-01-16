import "server-only";

import type { ChatMessage } from "./types";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const defaultModel = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

export async function chatWithOllama(opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
}) {
  const { messages, model = defaultModel, temperature = 0.7 } = opts;

  const res = await fetch(`${baseUrl}/api/chat`, noteNoStore({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      options: { temperature },
      stream: false,
    }),
  }));

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${errText}`);
  }

  const data: any = await res.json();
  const text: string = data?.message?.content ?? data?.response ?? "";

  return { text, raw: data };
}

/**
 * Evita caché accidental en runtimes server de Next.
 * (No hace daño fuera de Next.)
 */
function noteNoStore(init: RequestInit): RequestInit {
  return { ...init, cache: "no-store" };
}
