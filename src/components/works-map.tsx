"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Map as LeafletMap } from "leaflet";
import { directionsHref, type ProjectLocation } from "@/lib/project-location";
import { qty } from "@/lib/format";

export type MapWork = { _id: string; code: string; name: string; status: string; progress: number | null; location: ProjectLocation };

const statuses: Record<string, { label: string; color: string }> = {
  planificada: { label: "Pendiente", color: "#975c06" },
  en_curso: { label: "En ejecución", color: "#1461ae" },
  pausada: { label: "Pausada", color: "#844d99" },
  terminada: { label: "Terminada", color: "#148153" },
  cerrada: { label: "Cerrada", color: "#366d50" },
  cancelada: { label: "Cancelada", color: "#6c6e74" },
};
const statusOf = (work: MapWork) => statuses[work.status] || statuses.planificada;
const progressOf = (work: MapWork) => work.progress === null ? "Sin avance" : `${qty(work.progress)} %`;

export function WorksMap({ works }: { works: MapWork[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const mapped = works.filter(work => typeof work.location.latitude === "number" && typeof work.location.longitude === "number");

  useEffect(() => {
    let active = true;
    let map: LeafletMap | undefined;
    const target = container.current;
    if (!target) return;
    void import("leaflet").then(leaflet => {
      if (!active) return;
      map = leaflet.map(target, { scrollWheelZoom: false }).setView([-27.469, -58.831], 10);
      leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const bounds = leaflet.latLngBounds([]);
      for (const work of works) {
        const { latitude, longitude } = work.location;
        if (latitude === undefined || longitude === undefined) continue;
        const content = document.createElement("div");
        const title = document.createElement("a");
        title.href = `/app/works/${work._id}`;
        title.textContent = `${work.code} · ${work.name}`;
        const detail = document.createElement("p");
        detail.textContent = `${statusOf(work).label} · ${progressOf(work)}`;
        content.append(title, detail);
        const position = leaflet.latLng(latitude, longitude);
        const color = statusOf(work).color;
        leaflet.circleMarker(position, { radius: 9, color, fillColor: color, fillOpacity: 0.8, weight: 2 }).bindPopup(content).addTo(map);
        bounds.extend(position);
      }
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.12), { maxZoom: 15 });
    }).catch(() => { if (active) setError("No se pudo cargar el mapa"); });
    return () => { active = false; map?.remove(); };
  }, [works]);

  return <>
    {mapped.length > 0 ? <>
      <div className="works-map" ref={container} role="region" aria-label="Mapa de ubicaciones" />
      <div className="work-map-legend">{Object.values(statuses).map(status => <span key={status.label}><i style={{ backgroundColor: status.color }} />{status.label}</span>)}</div>
    </> : <p className="notice">Cargá coordenadas en una obra para verla en el mapa.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <ul className="work-map-list">{works.map(work => {
      const directions = directionsHref(work.location);
      return <li key={work._id}>
        <Link href={`/app/works/${work._id}`}><b>{work.code} · {work.name}</b></Link>
        <span>{statusOf(work).label} · {progressOf(work)}</span>
        {work.location.address && <span>{work.location.address}</span>}
        {directions && <a href={directions} target="_blank" rel="noreferrer">Cómo llegar</a>}
      </li>;
    })}</ul>
  </>;
}
