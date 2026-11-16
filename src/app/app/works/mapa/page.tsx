import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { Work } from "@/lib/models";
import { displayedProgress } from "@/lib/inspections";
import { WorksMap, type MapWork } from "@/components/works-map";
import "leaflet/dist/leaflet.css";

type WorkRow = Omit<MapWork, "_id" | "progress"> & { _id: unknown; progress?: number; progressMode?: string };

export default async function WorksMapPage() {
  const session = await requireSession();
  if (!canRead(session, "works")) notFound();
  const rows = await Work.find({ location: { $type: "object" } }).select("code name status progress progressMode location").sort({ code: 1 }).lean<WorkRow[]>();
  const works: MapWork[] = rows.map(work => ({
    _id: String(work._id), code: work.code, name: work.name, status: work.status,
    progress: displayedProgress(work), location: work.location,
  }));
  return <>
    <Link className="back-link" href="/app/works">Volver a obras</Link>
    <div className="page-heading"><div><h1>Mapa de obras</h1></div></div>
    <WorksMap works={works} />
  </>;
}
