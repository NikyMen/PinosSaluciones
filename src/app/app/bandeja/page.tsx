import { NotificationsInbox } from "@/components/notifications-inbox";
import { requireSession } from "@/lib/auth";

export default async function InboxPage() {
  const session = await requireSession();
  return <NotificationsInbox viewer={{ userId: session.userId, role: session.role }} />;
}
