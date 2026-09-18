"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Bot, Send, Sparkles, Trash2 } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "pinos-agenda-ai-chat";
const initialMessage: ChatMessage = {
  role: "assistant",
  content: "Pedime que agende una reunión (\"agendame una visita con Juan Pérez el jueves a las 10\") o que te diga los horarios libres de un día.",
};

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim().length > 0;
}

export function AgendaChat({ onBooked }: { onBooked?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
        if (active && Array.isArray(saved)) {
          const validMessages = saved.filter(isChatMessage).slice(-100);
          if (validMessages.length) setMessages(validMessages);
        }
      } catch {
        // La conversación puede continuar aunque el navegador no permita usar localStorage.
      }
      if (active) setStorageReady(true);
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (storageReady) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      } catch {
        // La conversación sigue disponible mientras la página permanezca abierta.
      }
    }
  }, [messages, storageReady]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, busy]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || busy) return;

    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/calendar/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-12) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "No se pudo obtener una respuesta.");
      const answer = result.message?.content;
      if (typeof answer !== "string" || !answer.trim()) throw new Error("La respuesta de DeepSeek está vacía.");
      setMessages(current => [...current, { role: "assistant", content: answer }]);
      if (result.booking) onBooked?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo enviar la consulta.");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function clearChat() {
    setMessages([initialMessage]);
    setError(null);
  }

  return (
    <section className="panel ai-chat-panel" aria-labelledby="agenda-chat-title" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <div className="section-title">
          <Sparkles aria-hidden="true" />
          <div>
            <h2 id="agenda-chat-title">Asistente de agenda</h2>
            <p>Pedile que consulte horarios o agende un turno.</p>
          </div>
        </div>
        <button className="secondary-btn" type="button" onClick={clearChat} disabled={busy}>
          <Trash2 size={15} /> Limpiar
        </button>
      </div>
      <div className="ai-chat-messages" ref={messagesRef} aria-live="polite">
        {messages.map((message, index) => (
          <article className={`ai-chat-message ${message.role}`} key={`${message.role}-${index}`}>
            <div className="ai-chat-message-meta">
              {message.role === "assistant" ? <Bot size={14} aria-hidden="true" /> : <span>Vos</span>}
              <b>{message.role === "assistant" ? "IA Pino" : "Vos"}</b>
            </div>
            <p>{message.content}</p>
          </article>
        ))}
        {busy && <article className="ai-chat-message assistant"><div className="ai-chat-message-meta"><Bot size={14} aria-hidden="true" /><b>IA Pino</b></div><p className="ai-chat-loading">Consultando la agenda<span>...</span></p></article>}
      </div>
      <form className="ai-chat-composer" onSubmit={send}>
        <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Escribí un pedido para la agenda..." maxLength={4_000} rows={3} disabled={busy} aria-label="Consulta para el asistente de agenda" />
        <div className="ai-chat-composer-actions">
          <small>Enter para enviar · Shift+Enter para salto de línea</small>
          <button className="primary-btn" type="submit" disabled={busy || !input.trim()}><Send size={16} /> {busy ? "Consultando..." : "Enviar"}</button>
        </div>
        {error && <p className="ai-chat-error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
