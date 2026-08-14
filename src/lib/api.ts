import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Error interno";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  if (message.includes("duplicate key")) return NextResponse.json({ error: "Ya existe un registro con ese número o código" }, { status: 409 });
  if (/MONGODB_URI|ECONNREFUSED|MongooseServerSelectionError|ENOTFOUND|ETIMEDOUT|ECONNRESET/.test(message)) {
    console.error("MongoDB no disponible:", message.split("\n")[0]);
    return NextResponse.json({ error: "La base de datos no está disponible. Verificá MONGODB_URI y que MongoDB sea accesible; luego reintentá." }, { status: 503 });
  }
  console.error(error);
  return NextResponse.json({ error: "No se pudo completar la operación" }, { status: 500 });
}
