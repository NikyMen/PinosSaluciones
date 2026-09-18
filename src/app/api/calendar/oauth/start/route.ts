import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { getGoogleOAuthUrl } from "@/lib/google-calendar";

export const runtime = "nodejs";

/** Solo gerencia puede conectar la cuenta de Google que va a usar toda la empresa. */
export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "gerencia") throw new Error("FORBIDDEN");
    return NextResponse.redirect(getGoogleOAuthUrl());
  } catch (error) {
    return apiError(error);
  }
}
