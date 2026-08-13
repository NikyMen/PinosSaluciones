import { UsersAdmin } from "@/components/users-admin";
import { requireSession } from "@/lib/auth";
import { notFound } from "next/navigation";
export default async function SettingsPage(){const session=await requireSession();if(session.role!=="gerencia")notFound();return <UsersAdmin/>;}
