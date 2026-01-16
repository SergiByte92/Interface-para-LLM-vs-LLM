import "server-only";
import { NextResponse } from "next/server";

import { chatWithOpenAI } from "@/lib/llm/openai";
import { chatWithOllama } from "@/lib/llm/ollama";
import type { ChatMessage, Provider } from "@/lib/llm/types";

function safePreview(s: string, n = 120) {
  const oneLine = (s ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

export async function POST(req: Request) {
  const trace = crypto.randomUUID().slice(0, 8);

  try {
    const body = (await req.json()) as {
      provider: Provider; // "openai" | "ollama"
      messages: ChatMessage[];
      model?: string;
      temperature?: number;
    };

    const provider = body.provider;
    const messages = body.messages ?? [];
    const temperature = body.temperature ?? 0.4;

    const lastMsg = messages.at(-1)?.content ?? "";
    console.log(
      `[chat:${trace}] provider=${provider} temp=${temperature} msgs=${messages.length} last="${safePreview(
        lastMsg
      )}"`
    );

    if (provider === "ollama") {
      const model = body.model ?? process.env.OLLAMA_MODEL ?? "llama3.2:3b";
      console.log(`[chat:${trace}] -> ollama model=${model}`);
      const out = await chatWithOllama({ messages, model, temperature });
      console.log(`[chat:${trace}] <- ollama chars=${out.text?.length ?? 0}`);
      return NextResponse.json({ trace, provider, model, text: out.text });
    }

    if (provider === "openai") {
      const model = body.model ?? "gpt-4o-mini";
      console.log(`[chat:${trace}] -> openai model=${model}`);
      const out = await chatWithOpenAI({ messages, model, temperature });
      console.log(`[chat:${trace}] <- openai chars=${out.text?.length ?? 0}`);
      return NextResponse.json({ trace, provider, model, text: out.text });
    }

    console.warn(`[chat:${trace}] invalid provider`, provider);
    return NextResponse.json({ trace, error: "Invalid provider" }, { status: 400 });
  } catch (e: any) {
    console.error(`[chat:${trace}] ERROR`, e?.message ?? e);
    return NextResponse.json({ trace, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
