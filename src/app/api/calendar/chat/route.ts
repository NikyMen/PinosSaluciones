import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createBooking, getAvailableSlots } from "@/lib/google-calendar";

export const runtime = "nodejs";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000),
});

const chatSchema = z.object({ messages: z.array(messageSchema).min(1).max(20) });

type ToolCall = { id: string; function: { name: string; arguments: string } };
type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
type DeepSeekResponse = {
  choices?: Array<{ message?: DeepSeekMessage }>;
  error?: { message?: string };
};

const tools = [
  {
    type: "function" as const,
    function: {
      name: "get_available_slots",
      description: "Consulta los horarios libres para agendar una reunión en una fecha dada.",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "Fecha en formato YYYY-MM-DD" } },
        required: ["date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_booking",
      description: "Agenda una reunión/turno en el calendario para una fecha y horario libres.",
      parameters: {
        type: "object",
        properties: {
          contactName: { type: "string", description: "Nombre de la persona con la que se agenda" },
          date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          time: { type: "string", description: "Horario en formato HH:mm, tiene que ser uno de los horarios libres" },
          notes: { type: "string", description: "Notas u observaciones opcionales" },
          contactPhone: { type: "string", description: "Teléfono de contacto, opcional" },
          contactEmail: { type: "string", description: "Email de contacto, opcional" },
        },
        required: ["contactName", "date", "time"],
      },
    },
  },
];

async function runTool(name: string, rawArgs: string, session: { userId: string; name: string }) {
  const args = JSON.parse(rawArgs || "{}");
  if (name === "get_available_slots") {
    return getAvailableSlots({ date: String(args.date) });
  }
  if (name === "create_booking") {
    const clientId = typeof args.clientId === "string" && isValidObjectId(args.clientId) ? args.clientId : undefined;
    const booking = await createBooking({
      clientId,
      contactName: String(args.contactName || "").trim(),
      contactPhone: args.contactPhone ? String(args.contactPhone) : undefined,
      contactEmail: args.contactEmail ? String(args.contactEmail) : undefined,
      date: String(args.date),
      time: String(args.time),
      notes: args.notes ? String(args.notes) : undefined,
      createdBy: { id: session.userId, name: session.name },
    });
    return { booking };
  }
  return { error: `Herramienta desconocida: ${name}` };
}

async function callDeepSeek(apiKey: string, model: string, messages: DeepSeekMessage[]) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto", stream: false, temperature: 0.2, max_tokens: 800 }),
  });
  const payload = await response.json().catch(() => null) as DeepSeekResponse | null;
  if (!response.ok) throw new Error(payload?.error?.message || "DeepSeek no pudo responder.");
  return payload;
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "calendario")) throw new Error("FORBIDDEN");

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) return Response.json({ error: "DeepSeek no está configurado. Agregá DEEPSEEK_API_KEY en .env." }, { status: 503 });
    const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";

    const parsed = chatSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "La conversación enviada no es válida." }, { status: 400 });

    const today = new Date().toISOString().slice(0, 10);
    const messages: DeepSeekMessage[] = [
      {
        role: "system",
        content: `Sos el asistente de agenda de Pino Soluciones Técnicas. Respondé en español, de forma breve y concreta. Hoy es ${today} (zona horaria America/Argentina/Buenos_Aires). Cuando te pidan agendar algo, primero consultá los horarios libres con get_available_slots antes de crear el turno, y solo usá create_booking con un horario que haya salido libre en esa consulta. Si falta el nombre de la persona con la que se agenda, pedilo antes de crear el turno.`,
      },
      ...parsed.data.messages.slice(-12),
    ];

    let payload = await callDeepSeek(apiKey, model, messages);
    let message = payload?.choices?.[0]?.message;
    let lastBooking: unknown = null;

    // Como mucho una vuelta de tool calls: alcanza para "consultar y agendar" en un solo pedido.
    if (message?.tool_calls?.length) {
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
      for (const call of message.tool_calls) {
        const result = await runTool(call.function.name, call.function.arguments, session);
        if (call.function.name === "create_booking" && result && typeof result === "object" && "booking" in result) {
          lastBooking = (result as { booking: unknown }).booking;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      payload = await callDeepSeek(apiKey, model, messages);
      message = payload?.choices?.[0]?.message;
    }

    const content = message?.content?.trim();
    if (!content) return Response.json({ error: "DeepSeek devolvió una respuesta vacía." }, { status: 502 });

    if (lastBooking && typeof lastBooking === "object" && "_id" in lastBooking) {
      await audit(session, "create", "calendario", (lastBooking as { _id: unknown })._id, null, lastBooking, request.headers.get("x-forwarded-for") || undefined);
    }

    return Response.json({ message: { role: "assistant", content }, booking: lastBooking });
  } catch (error) {
    return apiError(error);
  }
}
