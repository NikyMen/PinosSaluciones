import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { exchangeGoogleOAuthCode } from "@/lib/google-calendar";

export const runtime = "nodejs";

function back(request: Request, query: string) {
  return NextResponse.redirect(new URL(`/app/calendario?${query}`, request.url));
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") return back(request, "calendarError=Sin+permisos+para+conectar+Google");

    const { searchParams } = new URL(request.url);
    const error = searchParams.get("error");
    if (error) return back(request, `calendarError=${encodeURIComponent(error)}`);

    const code = searchParams.get("code");
    if (!code) return back(request, "calendarError=Google+no+envió+un+código+de+autorización");

    await exchangeGoogleOAuthCode(code);
    return back(request, "calendarConnected=1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo conectar con Google Calendar";
    return back(request, `calendarError=${encodeURIComponent(message)}`);
  }
}
