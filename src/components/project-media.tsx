"use client";

import Image from "next/image";
import { useState } from "react";
import { FileDrop } from "@/components/fields";
import { coordinatesFromMaps, directionsHref, type ProjectLocation } from "@/lib/project-location";

const photoAccept = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif";

export function ProjectMediaFields({ location, photos = [], allowPhotos = false }: { location?: ProjectLocation | null; photos?: string[]; allowPhotos?: boolean }) {
  const [url, setUrl] = useState(location?.mapUrl || "");
  const [lat, setLat] = useState(location?.latitude?.toString() || "");
  const [lon, setLon] = useState(location?.longitude?.toString() || "");
  return <fieldset className="project-media-fields">
    <legend><b>Ubicación{allowPhotos && " y fotos"}</b></legend>
    <div className="form-grid">
      <label><span>Dirección</span><input name="projectAddress" maxLength={300} defaultValue={location?.address || ""} /></label>
      <label><span>Enlace de Google Maps</span><input type="url" name="projectMapUrl" maxLength={1800} value={url} onChange={event => {
        setUrl(event.target.value);
        const coords = coordinatesFromMaps(event.target.value);
        setLat(coords?.latitude?.toString() || "");
        setLon(coords?.longitude?.toString() || "");
      }} /></label>
      <label><span>Latitud<em className="field-hint">Para mostrar la obra en el mapa</em></span><input type="number" step="any" min={-90} max={90} name="projectLatitude" value={lat} onChange={event => setLat(event.target.value)} /></label>
      <label><span>Longitud</span><input type="number" step="any" min={-180} max={180} name="projectLongitude" value={lon} onChange={event => setLon(event.target.value)} /></label>
      {allowPhotos && <div className="wide">
        <label><span>Fotos</span><FileDrop name="projectPhotos" accept={photoAccept} formats="JPG, PNG, WebP, GIF y HEIC" multiple /></label>
        {photos.map((photo, index) => <label className="checkbox-line" key={photo}>
          <input name="keepProjectPhoto" type="checkbox" defaultChecked value={photo} /> <span>Conservar foto {index + 1}</span>
        </label>)}
      </div>}
    </div>
  </fieldset>;
}

export function ProjectMediaPanel({ location, photos = [] }: { location?: ProjectLocation | null; photos?: string[] }) {
  const maps = directionsHref(location);
  if (!location && !photos.length) return null;
  return <section className="panel project-media-panel">
    <h2>Ubicación y fotos</h2>
    {location?.address && <p>{location.address}</p>}
    {maps && <a className="secondary-btn" href={maps} target="_blank" rel="noreferrer">Cómo llegar</a>}
    {photos.length > 0 && <div className="project-photos">{photos.map((photo, index) => <a key={photo} href={photo} target="_blank" rel="noreferrer">
      <Image src={photo} alt={`Foto de obra ${index + 1}`} width={250} height={170} unoptimized />
    </a>)}</div>}
  </section>;
}
