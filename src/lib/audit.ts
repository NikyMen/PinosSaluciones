import { AuditLog } from "./models";
import type { Session } from "./auth";

export async function audit(session: Session, action: string, entity: string, entityId: unknown, before: unknown, after: unknown, ip?: string) {
  await AuditLog.create({ userId: session.userId, userName: session.name, userEmail: session.email, action, entity, entityId, before, after, ip });
}
