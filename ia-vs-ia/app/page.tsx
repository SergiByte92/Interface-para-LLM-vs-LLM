"use client";

import * as React from "react";
import { MessageSquare, Settings, X } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";

type Provider = "ollama" | "openai";

type Msg = {
  id: string;
  provider: Provider;
  fullText: string;
  renderedText: string;
  createdAt: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function toChatMessages(history: Msg[]): ChatMessage[] {
  return history.map((m) => ({ role: "assistant", content: m.fullText }));
}

function useTeletypeSound() {
  const ctxRef = React.useRef<AudioContext | null>(null);
  const lastRef = React.useRef<number>(0);

  const ensure = React.useCallback(async () => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
    if (ctxRef.current.state === "suspended") {
      await ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const click = React.useCallback(
    async (volume = 0.03) => {
      const t = performance.now();
      if (t - lastRef.current < 18) return; // throttling
      lastRef.current = t;

      const ctx = await ensure();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.value = 1200;

      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const startAt = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.03);

      osc.start(startAt);
      osc.stop(startAt + 0.035);
    },
    [ensure]
  );

  return { ensure, click };
}

export default function Page() {
  // Running
  const [running, setRunning] = React.useState(false);
  const runningRef = React.useRef(false);

  // ✅ conversación finalizada por límite de turnos
  const [finished, setFinished] = React.useState(false);

  const [history, setHistory] = React.useState<Msg[]>([]);
  const historyRef = React.useRef<Msg[]>([]);
  React.useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const turnsRef = React.useRef(0);
  const MAX_TURNS_TOTAL = 10; // 5 Llama + 5 OpenAI

  // Controls
  const [panelOpen, setPanelOpen] = React.useState(false);

  const [autoScroll, setAutoScroll] = React.useState(true);
  const [soundEnabled, setSoundEnabled] = React.useState(true);

  const [speed, setSpeed] = React.useState(85);
  const [tone, setTone] = React.useState(0.35);
  const [aggr, setAggr] = React.useState(0.7);

  const [infinite, setInfinite] = React.useState(true);
  const [maxTurns, setMaxTurns] = React.useState(30);

  const [cooldownMs, setCooldownMs] = React.useState(650);
  const [volume, setVolume] = React.useState(0.03);

  // Safety/limits
  const stopWord = "STOP_SESSION";
  // 👇 subimos mucho el límite para que NO recorte casi nunca
  const maxCharsPerMsg = 9000;

  // Sound
  const { ensure: ensureAudio, click: teletypeClick } = useTeletypeSound();

  // Scroll host
  const scrollHostRef = React.useRef<HTMLDivElement | null>(null);
  const scrollToBottom = React.useCallback(() => {
    if (!autoScroll) return;
    const el = scrollHostRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoScroll]);

  // Tema + estilo "bar" (pero educativo/crítico, sin apología)
  const seedPrompt =
    "Tema: Alemania nazi (1933–1945). Conversación de cuñados: " +
    "cómo se vendió el relato, propaganda, maniobras políticas, complicidades, economía de guerra, persecución y consecuencias. " +
    "Tono cercano (como charla entre colegas), directo y con ejemplos, sin sermonear.";

  function buildMessages(provider: Provider, snapshot: Msg[]): ChatMessage[] {
    const aggrStyle =
      aggr < 0.34
        ? "Tono tranquilo, poca confrontación."
        : aggr < 0.67
        ? "Tono firme, contraargumentos directos."
        : "Tono intenso: desmonta falacias rápido y con punch, pero sin insultos personales.";

    return [
      {
        role: "system",
        content:
          "Conversación de cuñados. Prohibido glorificar, justificar o hacer propaganda del nazismo. " +
          "No usar simbología ni eslóganes. No negar/relativizar crímenes. " +
          "Si aparece desinformación o apología, corrige y reconduce. " +
          `Si no puedes continuar de forma segura, responde exactamente: ${stopWord}. ` +
          "Responde SOLO con el texto del turno (sin prefijos tipo 'OLLAMA:'/'OPENAI:'). " +
          // 👇 aquí forzamos turnos cortos para que NO se hagan tochos
          "Formato: 1–3 frases cortas por turno. Máximo ~350 caracteres por turno. " +
          aggrStyle,
      },
      { role: "user", content: seedPrompt },
      ...toChatMessages(snapshot),
      {
        role: "user",
        content:
          provider === "ollama"
            ? "Rol: analista político de calle. Señala maniobras, incentivos, propaganda, pactos y juegos de poder. Breve y al grano."
            : "Rol: historiador crítico. Baja a tierra, mete contexto, desmonta mitos y señala consecuencias humanas. Breve y al grano.",
      },
    ];
  }

  async function callApi(
    provider: Provider,
    messages: ChatMessage[],
    temperature: number
  ) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, messages, temperature }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Request failed");
    return String(data?.text ?? "").trim();
  }

  function computeTemperature(provider: Provider) {
    const t = clamp(tone, 0, 1);
    return provider === "openai" ? 0.15 + t * 0.35 : 0.30 + t * 0.45;
  }

  async function getTurnText(provider: Provider, snapshot: Msg[]) {
    const messages = buildMessages(provider, snapshot);
    let text = await callApi(provider, messages, computeTemperature(provider));

    // fallback si Ollama devuelve vacío
    if (!text && provider === "ollama") {
      text = await callApi("openai", messages, computeTemperature("openai"));
    }

    text = (text ?? "").trim();
    if (!text) throw new Error("Empty response");
    if (text.includes(stopWord)) throw new Error(stopWord);

    // ✅ recorte sin añadir "…"
    if (text.length > maxCharsPerMsg) text = text.slice(0, maxCharsPerMsg);

    return text;
  }

  // Typewriter
  const typeTimerRef = React.useRef<number | null>(null);
  const stopTypewriter = React.useCallback(() => {
    if (typeTimerRef.current) {
      window.clearInterval(typeTimerRef.current);
      typeTimerRef.current = null;
    }
  }, []);

  const typeIntoMessage = React.useCallback(
    (msgId: string, fullText: string) => {
      stopTypewriter();
      return new Promise<void>((resolve) => {
        const chars = Array.from(fullText);
        let i = 0;

        const cps = clamp(speed, 20, 220);
        const intervalMs = Math.max(10, Math.floor(1000 / cps));
        const batch = cps > 120 ? 3 : cps > 80 ? 2 : 1;

        typeTimerRef.current = window.setInterval(async () => {
          if (!runningRef.current) {
            stopTypewriter();
            resolve();
            return;
          }

          let chunk = "";
          for (let k = 0; k < batch && i < chars.length; k++, i++) {
            chunk += chars[i];
          }

          if (chunk) {
            setHistory((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, renderedText: (m.renderedText ?? "") + chunk }
                  : m
              )
            );

            if (soundEnabled) void teletypeClick(volume);
            scrollToBottom();
          }

          if (i >= chars.length) {
            stopTypewriter();
            scrollToBottom();
            resolve();
          }
        }, intervalMs);
      });
    },
    [speed, soundEnabled, volume, teletypeClick, scrollToBottom, stopTypewriter]
  );

  const stop = React.useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    stopTypewriter();
  }, [stopTypewriter]);

  const clear = React.useCallback(() => {
    stop();
    turnsRef.current = 0;
    setHistory([]);
    setFinished(false); // ✅ reseteamos estado de conversación finalizada
  }, [stop]);

  const start = React.useCallback(async () => {
    if (runningRef.current) return;
    if (finished) return; // ✅ no lanzar más si ya terminó

    if (soundEnabled) {
      try {
        await ensureAudio();
      } catch {
        // ignore
      }
    }

    runningRef.current = true;
    setRunning(true);

    let next: Provider = "ollama";

    while (runningRef.current) {
      // ✅ límite fijo 10 turnos totales
      if (turnsRef.current >= MAX_TURNS_TOTAL) {
        stop();
        setFinished(true);
        break;
      }

      const snapshot = historyRef.current;

      try {
        const fullText = await getTurnText(next, snapshot);

        const msg: Msg = {
          id: crypto.randomUUID(),
          provider: next,
          fullText,
          renderedText: "",
          createdAt: Date.now(),
        };

        setHistory((prev) => [...prev, msg]);
        await sleep(0);

        await typeIntoMessage(msg.id, msg.fullText);

        turnsRef.current += 1;
        next = next === "ollama" ? "openai" : "ollama";

        await sleep(clamp(cooldownMs, 0, 5000));
      } catch (e: any) {
        const message = String(e?.message ?? e ?? "unknown error");

        setHistory((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            provider: "openai",
            fullText:
              message === stopWord
                ? "La sesión se detuvo por límites de seguridad del contenido."
                : `ERROR: ${message}`,
            renderedText:
              message === stopWord
                ? "La sesión se detuvo por límites de seguridad del contenido."
                : `ERROR: ${message}`,
            createdAt: Date.now(),
          },
        ]);

        stop();
        break;
      }
    }
  }, [
    soundEnabled,
    ensureAudio,
    finished,
    cooldownMs,
    typeIntoMessage,
    stop,
  ]);

  function labelFor(p: Provider) {
    return p === "openai" ? "OPENAI" : "OLLAMA";
  }

  return (
    <main className="min-h-screen">
      {/* Fondo madera a pantalla completa */}
      <div className="wood-bg min-h-screen">
        <div className="wood-overlay min-h-screen px-6 py-6">
          <div className="mx-auto w-full max-w-6xl">
            <div className="relative overflow-hidden rounded-2xl border border-[#3b2a1b] bg-[#2b1f16]/15 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
              {/* Header */}
              <div className="flex items-center gap-2 border-b border-[#3b2a1b]/40 bg-[#1a1410]/35 px-4 py-3 backdrop-blur-[2px]">
                <button
                  onClick={running ? stop : start}
                  disabled={finished} // ✅ desactivado cuando termina
                  className="rounded-md border border-[#3b2a1b]/60 bg-[#efe6d6] px-3 py-1 text-sm text-[#1a1410] shadow-[2px_2px_0_rgba(0,0,0,0.25)] hover:bg-[#f5efdf] disabled:opacity-60"
                >
                  {finished ? "Finished" : running ? "Stop" : "Start"}
                </button>

                <span className="text-xs tracking-widest text-[#efe6d6]/80">
                  {finished
                    ? "COMPLETED (10 TURNS)"
                    : running
                    ? "RUNNING"
                    : "STOPPED"}
                </span>

                <span className="ml-4 text-[11px] tracking-widest text-[#efe6d6]/70">
                  TURNS {turnsRef.current}/{MAX_TURNS_TOTAL}
                </span>

                <button
                  onClick={clear}
                  className="ml-auto rounded-md border border-[#3b2a1b]/60 bg-[#efe6d6] px-3 py-1 text-sm text-[#1a1410] shadow-[2px_2px_0_rgba(0,0,0,0.25)] hover:bg-[#f5efdf] disabled:opacity-40"
                  disabled={running}
                >
                  Clear
                </button>

                <button
                  onClick={() => setPanelOpen((v) => !v)}
                  className="ml-2 inline-flex items-center gap-2 rounded-md border border-[#3b2a1b]/60 bg-[#efe6d6] px-3 py-1 text-sm text-[#1a1410] shadow-[2px_2px_0_rgba(0,0,0,0.25)] hover:bg-[#f5efdf]"
                  title="Ajustes"
                >
                  <Settings className="h-4 w-4" />
                  Ajustes
                </button>
              </div>

              {/* Panel ajustes (compacto) */}
              {panelOpen && (
                <div className="absolute right-4 top-14 z-20 w-[340px] rounded-xl border border-[#3b2a1b]/60 bg-[#efe6d6] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.45)]">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-xs font-semibold tracking-widest text-[#3b2a1b]">
                      CONTROLES
                    </div>
                    <button
                      onClick={() => setPanelOpen(false)}
                      className="rounded-md border border-[#3b2a1b]/40 bg-[#f5efdf] p-1 hover:bg-[#fff6e8]"
                    >
                      <X className="h-4 w-4 text-[#3b2a1b]" />
                    </button>
                  </div>

                  <div className="space-y-3 text-sm text-[#1a1410]">
                    <div>
                      <div className="flex items-center justify-between text-xs text-[#3b2a1b]">
                        <span>Velocidad</span>
                        <span>{speed} cps</span>
                      </div>
                      <input
                        type="range"
                        min={20}
                        max={200}
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        className="w-full accent-[#7a2b1a]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-[#3b2a1b]">
                        <span>Cooldown</span>
                        <span>{cooldownMs} ms</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2500}
                        step={50}
                        value={cooldownMs}
                        onChange={(e) => setCooldownMs(Number(e.target.value))}
                        className="w-full accent-[#7a2b1a]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-[#3b2a1b]">
                        <span>Tono (creatividad)</span>
                        <span>{tone.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={tone}
                        onChange={(e) => setTone(Number(e.target.value))}
                        className="w-full accent-[#7a2b1a]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-[#3b2a1b]">
                        <span>Agresividad</span>
                        <span>{aggr.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={aggr}
                        onChange={(e) => setAggr(Number(e.target.value))}
                        className="w-full accent-[#7a2b1a]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={autoScroll}
                          onChange={(e) => setAutoScroll(e.target.checked)}
                          className="accent-[#7a2b1a]"
                        />
                        <span>Auto-scroll</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={soundEnabled}
                          onChange={(e) => setSoundEnabled(e.target.checked)}
                          className="accent-[#7a2b1a]"
                        />
                        <span>Sonido</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={infinite}
                          onChange={(e) => setInfinite(e.target.checked)}
                          className="accent-[#7a2b1a]"
                        />
                        <span>Infinito</span>
                      </label>
                    </div>

                    {soundEnabled && (
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#3b2a1b]">
                          <span>Volumen</span>
                          <span>{volume.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0.0}
                          max={0.08}
                          step={0.005}
                          value={volume}
                          onChange={(e) => setVolume(Number(e.target.value))}
                          className="w-full accent-[#7a2b1a]"
                        />
                      </div>
                    )}

                    {!infinite && (
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#3b2a1b]">
                          <span>Máx. turnos</span>
                          <span>{maxTurns}</span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={200}
                          value={maxTurns}
                          onChange={(e) => setMaxTurns(Number(e.target.value))}
                          className="w-full accent-[#7a2b1a]"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Chat */}
              <div className="p-4">
                <Conversation>
                  <ConversationContent>
                    <div
                      ref={scrollHostRef}
                      className={[
                        "h-[74vh] overflow-auto rounded-xl border p-5",
                        "border-[#6b4a2b]",
                        "bg-[#efe6d6]", // papel viejo OPACO (alto contraste con madera)
                        "shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
                      ].join(" ")}
                    >
                      {history.length === 0 ? (
                        <ConversationEmptyState
                          icon={<MessageSquare className="size-12" />}
                          title="Session"
                          description={
                            finished
                              ? "Conversación finalizada (5 turnos por cada IA)"
                              : running
                              ? "Generando…"
                              : "Pulsa Start"
                          }
                        />
                      ) : (
                        <div className="flex flex-col gap-3">
                          {history.map((m) => {
                            const isOpenAI = m.provider === "openai";
                            return (
                              <div
                                key={m.id}
                                className={`flex ${
                                  isOpenAI ? "justify-end" : "justify-start"
                                }`}
                              >
                                <div
                                  className={[
                                    "paper-in",
                                    "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                                    "border font-mono",
                                    "border-[#5a3e24]",
                                    "shadow-[4px_4px_0_rgba(0,0,0,0.25)]",
                                    isOpenAI ? "bg-[#ffffff]" : "bg-[#f8f1e3]",
                                  ].join(" ")}
                                >
                                  <div className="mb-1 flex items-center justify-between text-[11px] tracking-widest text-[#5a3e24]/80">
                                    <span className="font-semibold">
                                      {labelFor(m.provider)}
                                    </span>
                                    <span className="opacity-70">TELETYPE</span>
                                  </div>

                                  <div className="whitespace-pre-wrap text-[#1a1410]">
                                    {m.renderedText}
                                    {running &&
                                      m.renderedText.length <
                                        m.fullText.length && (
                                        <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-[#7a2b1a]/60 align-middle" />
                                      )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </ConversationContent>

                  <ConversationScrollButton />
                </Conversation>

                <div className="mt-3 text-xs tracking-widest text-[#efe6d6]/80">
                  WOOD · PAPER · TELETYPE · CONTROLS IN ⚙️
                </div>

                {finished && (
                  <div className="mt-1 text-center text-[11px] font-semibold uppercase tracking-widest text-[#efe6d6]/90">
                    Conversación nazi finalizada · 5 turnos por LLAMA y 5 por OPENAI
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <style jsx global>{`
          .wood-bg {
            background-image: url("/wood.jpg");
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
          }
          .wood-overlay {
            background: radial-gradient(
                1200px 600px at 18% 15%,
                rgba(255, 255, 255, 0.18),
                transparent 60%
              ),
              radial-gradient(
                1000px 520px at 82% 20%,
                rgba(0, 0, 0, 0.18),
                transparent 62%
              ),
              rgba(0, 0, 0, 0.28);
          }
          @keyframes paperIn {
            0% {
              transform: translateY(10px) scale(0.985);
              opacity: 0;
              filter: blur(0.3px);
            }
            100% {
              transform: translateY(0) scale(1);
              opacity: 1;
              filter: blur(0);
            }
          }
          .paper-in {
            animation: paperIn 220ms ease-out both;
          }
        `}</style>
      </div>
    </main>
  );
}
