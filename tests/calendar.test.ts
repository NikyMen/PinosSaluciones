import { describe, expect, it } from "vitest";
import { computeDaySlots, isoDayOf } from "../src/lib/google-calendar";

const rules = { workingHoursStart: "09:00", workingHoursEnd: "12:00", slotIntervalMinutes: 30, bufferBetweenMeetings: 15 };
// Sin offset, igual que como computeDaySlots parsea sus propios horarios: unos dias antes del caso, para no excluir nada por "ya paso".
const earlyNow = new Date("2026-01-01T00:00:00").getTime();

describe("agenda: dia de la semana ISO", () => {
  it("mapea domingo a 7 en vez de 0", () => {
    expect(isoDayOf("2026-01-04")).toBe(7); // domingo
    expect(isoDayOf("2026-01-05")).toBe(1); // lunes
    expect(isoDayOf("2026-01-10")).toBe(6); // sabado
  });
});

describe("agenda: calculo de horarios libres", () => {
  it("genera un slot por cada intervalo dentro del horario laboral", () => {
    const slots = computeDaySlots({ date: "2026-01-05", duration: 30, rules, now: earlyNow });
    expect(slots.map(slot => slot.time)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  });

  it("no ofrece un turno que no entra completo antes del cierre", () => {
    const slots = computeDaySlots({ date: "2026-01-05", duration: 45, rules, now: earlyNow });
    // El ultimo que entra completo es 11:15-12:00; 11:30 ya se pasaria del cierre.
    expect(slots.at(-1)?.time).toBe("11:15");
  });

  it("descarta los horarios que ya pasaron (con el margen de 15 minutos)", () => {
    // computeDaySlots parsea sus propios horarios sin offset (hora local del proceso);
    // el "now" del test se construye igual, así el resultado no depende de la zona horaria de quien corre el test.
    const now = new Date("2026-01-05T09:50:00").getTime();
    const slots = computeDaySlots({ date: "2026-01-05", duration: 30, rules, now });
    expect(slots.map(slot => slot.time)).toEqual(["10:30", "11:00", "11:30"]);
  });

  it("saca los horarios que se solapan con un evento ocupado, respetando el buffer", () => {
    // Reunion ocupada de 10:00 a 10:30, con buffer de 15 minutos.
    const busy = [{ start: new Date("2026-01-05T10:00:00").getTime(), end: new Date("2026-01-05T10:30:00").getTime() }];
    const slots = computeDaySlots({ date: "2026-01-05", duration: 30, rules, busy, now: earlyNow });
    expect(slots.map(slot => slot.time)).toEqual(["09:00", "11:00", "11:30"]);
  });
});
