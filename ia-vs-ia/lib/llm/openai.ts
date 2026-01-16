import "server-only";

import OpenAI from "openai";
import type { ChatMessage } from "./types";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

const openai = new OpenAI({ apiKey });

export async function chatWithOpenAI(opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
}) {
  const { messages, model = "gpt-4o-mini", temperature = 0.7 } = opts;

  const res = await openai.chat.completions.create({
    model,
    temperature,
    messages,
  });

  const text = res.choices?.[0]?.message?.content ?? "";
  return { text, raw: res };
}
