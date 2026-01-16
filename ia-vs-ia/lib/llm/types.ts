export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type Provider = "openai" | "ollama" | "auto";

export type ChatRequest = {
  provider?: Provider;
  messages: ChatMessage[];

  temperature?: number;

  // Overrides opcionales por request
  openaiModel?: string;
  ollamaModel?: string;
};

export type ChatResponse = {
  provider: Exclude<Provider, "auto">;
  text: string;
};
