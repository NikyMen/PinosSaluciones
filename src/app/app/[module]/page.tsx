import { notFound } from "next/navigation";
import { entities, type Entity } from "@/lib/constants";
import { EntityManager } from "@/components/entity-manager";

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params; if (!entities.includes(module as Entity)) notFound();
  return <EntityManager entity={module as Entity}/>;
}
