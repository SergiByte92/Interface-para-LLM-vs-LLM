import "server-only";
import { NextResponse } from "next/server";

import { chatWithOpenAI } from "@/lib/llm/openai";
import type { ChatMessage, Provider } from "@/lib/llm/types";

function safePreview(s: string, n = 120) {
  const oneLine = (s ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

function extractOllamaTextFromUnknown(payload: any): string {
  // Ollama suele devolver:
  // - { message: { content: "..." }, done: true, ... }
  // - streaming NDJSON con líneas similares, que aquí vamos acumulando fuera
  const msg = payload?.message?.content;
  if (typeof msg === "string") return msg;

  const resp = payload?.response;
  if (typeof resp === "string") return resp;

  // fallback
  if (typeof payload?.text === "string") return payload.text;

  return "";
}

function parseOllamaNDJSON(raw: string): string {
  // Ollama streaming: muchas líneas JSON separadas por \n
  // Si alguna línea viene “sucia”, la saltamos en vez de reventar todo.
  let out = "";
  const lines = raw.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const chunk = extractOllamaTextFromUnknown(obj);
      if (chunk) out += chunk;
      // algunos streams traen done=true al final, no hace falta aquí
    } catch {
      // ignoramos líneas inválidas
    }
  }
  return out;
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

    // =========================
    // OLLAMA (robusto + fallback)
    // =========================
    if (provider === "ollama") {
      const model = body.model ?? process.env.OLLAMA_MODEL ?? "llama3.2:3b";

      // En Vercel, lo normal es que Ollama NO esté disponible.
      // Si no hay URL explícita, devolvemos OK con text vacío para que el front haga fallback a OpenAI.
      const baseUrl =
        process.env.OLLAMA_BASE_URL ||
        process.env.OLLAMA_URL ||
        ""; // ej: "http://127.0.0.1:11434"

      if (!baseUrl) {
        console.warn(
          `[chat:${trace}] ollama not configured (missing OLLAMA_BASE_URL). Returning empty text for frontend fallback.`
        );
        return NextResponse.json({
          trace,
          provider,
          model,
          text: "",
          warning: "Ollama not configured on this deployment. Fallback to OpenAI.",
        });
      }

      try {
        console.log(`[chat:${trace}] -> ollama model=${model} url=${baseUrl}`);

        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // MUY IMPORTANTE: pedimos NO streaming para simplificar.
          // Si el servidor igual devuelve NDJSON, lo soportamos abajo.
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: { temperature },
          }),
        });

        const raw = await res.text();

        if (!res.ok) {
          console.warn(
            `[chat:${trace}] ollama HTTP ${res.status}. Returning empty text for frontend fallback.`
          );
          return NextResponse.json({
            trace,
            provider,
            model,
            text: "",
            warning: `Ollama HTTP ${res.status}. Fallback to OpenAI.`,
          });
        }

        // Primero intentamos JSON normal
        let text = "";
        try {
          const obj = JSON.parse(raw);
          text = extractOllamaTextFromUnknown(obj);
        } catch {
          // Si no era JSON “de una pieza”, probamos NDJSON
          text = parseOllamaNDJSON(raw);
        }

        text = String(text ?? "").trim();
        console.log(`[chat:${trace}] <- ollama chars=${text.length}`);

        // Si Ollama devuelve vacío, devolvemos vacío (front hará fallback)
        return NextResponse.json({ trace, provider, model, text });
      } catch (err: any) {
        // Aquí caen: ECONNREFUSED en Vercel, timeouts, etc.
        console.warn(
          `[chat:${trace}] ollama fetch failed: ${err?.message ?? err}. Returning empty text for frontend fallback.`
        );
        return NextResponse.json({
          trace,
          provider,
          model,
          text: "",
          warning: "Ollama unreachable. Fallback to OpenAI.",
        });
      }
    }

    // ==========
    // OPENAI
    // ==========
    if (provider === "openai") {
      const model = body.model ?? "gpt-4o-mini";
      console.log(`[chat:${trace}] -> openai model=${model}`);

      const out = await chatWithOpenAI({ messages, model, temperature });

      const text = String(out.text ?? "").trim();
      console.log(`[chat:${trace}] <- openai chars=${text.length}`);

      return NextResponse.json({ trace, provider, model, text });
    }

    console.warn(`[chat:${trace}] invalid provider`, provider);
    return NextResponse.json({ trace, error: "Invalid provider" }, { status: 400 });
  } catch (e: any) {
    console.error(`[chat:${trace}] ERROR`, e?.message ?? e);
    return NextResponse.json(
      { trace, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
};