import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { canViewSection } from "@/lib/permissions";
import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(8_000),
});

const reportSchema = z.object({
  cashflow: z.array(z.object({
    period: z.string(),
    incomeCents: z.number(),
    outcomeCents: z.number(),
  })).max(24),
  profitability: z.array(z.object({
    id: z.string(),
    name: z.string(),
    budgetCents: z.number(),
    revenueCents: z.number(),
    costCents: z.number(),
    marginCents: z.number(),
  })).max(200),
});

const chatSchema = z.object({
  messages: z.array(messageSchema).min(1).max(30),
  report: reportSchema.nullable().optional(),
});

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!canViewSection(session, "reports")) throw new Error("FORBIDDEN");

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) return Response.json({ error: "DeepSeek no está configurado. Agregá DEEPSEEK_API_KEY en .env." }, { status: 503 });

    const parsed = chatSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "La conversación enviada no es válida." }, { status: 400 });

    const reportContext = parsed.data.report
      ? JSON.stringify(parsed.data.report)
      : "No hay datos de reporte disponibles en esta consulta.";
    const messages = [
      {
        role: "system" as const,
        content: "Sos la IA interna de Pino Soluciones Técnicas. Respondé en español, de forma clara y accionable. Analizá únicamente los datos del reporte que recibís; si falta información, decilo y no inventes valores. Los importes están expresados en centavos de peso argentino.",
      },
      {
        role: "system" as const,
        content: `Contexto del reporte de gestión actual: ${reportContext}`,
      },
      ...parsed.data.messages.slice(-20),
    ];

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
        messages,
        stream: false,
        temperature: 0.2,
        max_tokens: 1_200,
      }),
    });
    const payload = await response.json().catch(() => null) as DeepSeekResponse | null;
    if (!response.ok) {
      console.error("DeepSeek API error", { status: response.status, message: payload?.error?.message });
      return Response.json({ error: "DeepSeek no pudo responder. Verificá la API key y el modelo configurado." }, { status: 502 });
    }

    const content = payload?.choices?.[0]?.message?.content?.trim();
    if (!content) return Response.json({ error: "DeepSeek devolvió una respuesta vacía." }, { status: 502 });
    return Response.json({ message: { role: "assistant", content } });
  } catch (error) {
    return apiError(error);
  }
}
