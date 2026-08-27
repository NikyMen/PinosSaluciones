"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ListTodo } from "lucide-react";

/**
 * Atajo a Tareas y pendientes, al lado de la campanita, con la cuenta de lo que
 * está sin terminar. Se refresca cada minuto, igual que los avisos.
 */
export function TasksButton() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const read = () => {
      void fetch("/api/records/tasks?limit=100")
        .then(response => response.ok ? response.json() as Promise<{ items?: Array<{ status?: string }> }> : null)
        .then(result => {
          if (!result) return;
          setPending((result.items || []).filter(task => task.status !== "completada").length);
        });
    };
    const timer = window.setInterval(read, 60000);
    read();
    return () => window.clearInterval(timer);
  }, []);

  return <Link href="/app/tasks" className={pending ? "tasks-btn has-pending" : "tasks-btn"}
    aria-label={pending ? `Tareas y pendientes: ${pending} sin terminar` : "Tareas y pendientes"} title="Tareas y pendientes">
    <ListTodo size={19} />
    {pending > 0 && <span className="tasks-count">{pending > 99 ? "99+" : pending}</span>}
  </Link>;
}
