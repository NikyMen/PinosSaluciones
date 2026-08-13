import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Error interno";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  if (message.includes("duplicate key")) return NextResponse.json({ error: "Ya existe un registro con ese número o código" }, { status: 409 });
  console.error(error);
  return NextResponse.json({ error: "No se pudo completar la operación" }, { status: 500 });
}
