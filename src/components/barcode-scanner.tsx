"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Flashlight, FlashlightOff, ScanBarcode, X } from "lucide-react";
import { cleanScannedCode } from "@/lib/barcode";

/* ─────────────────────────────────────────────────────────────────────────────
   Lectura de códigos de barras.

   - El lector de mano (USB o bluetooth) se comporta como un teclado: escribe
     el código de golpe y aprieta Enter. `useKeyboardScanner` lo agarra aunque
     el cursor no esté en ningún campo.
   - La cámara del celular: en Android y Chrome el navegador trae su propio
     lector (BarcodeDetector); en iPhone se usa zxing. La cámara pide https.
   ───────────────────────────────────────────────────────────────────────────── */

/** Un lector escribe mucho más rápido que una persona: menos de 50 ms entre tecla y tecla. */
const SCANNER_GAP_MS = 50;

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName));
}

/**
 * Lo que el lector de mano escribe cuando el foco no está en un campo: se
 * junta y, al llegar el Enter, se entrega entero. Lo que se tipea a mano, más
 * lento, no se toma como un código.
 */
export function useKeyboardScanner(onScan: (code: string) => void, enabled = true) {
  const handler = useRef(onScan);
  useEffect(() => { handler.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const now = performance.now();
      if (now - last > SCANNER_GAP_MS * 4) buffer = "";
      last = now;
      if (event.key === "Enter") {
        const code = cleanScannedCode(buffer);
        buffer = "";
        if (code.length >= 3) { event.preventDefault(); handler.current(code); }
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** Un pitido corto y una vibración: se sabe que leyó sin mirar la pantalla. */
export function scanFeedback(ok = true) {
  try { navigator.vibrate?.(ok ? 60 : [40, 60, 40]); } catch { /* no vibra */ }
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const context = new AudioCtx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = ok ? 1250 : 330;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (ok ? 0.09 : 0.25));
    oscillator.onended = () => { void context.close(); };
  } catch { /* sin sonido */ }
}

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type DetectorClass = { new (options?: { formats?: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code", "data_matrix"];

/**
 * La cámara abierta, leyendo. Con `continuous` queda abierta para seguir
 * escaneando (la caja); si no, se cierra con el primer código.
 */
export function CameraScanner({ onDetected, onClose, continuous = false, title = "Escanear con la cámara" }: {
  onDetected: (code: string) => void; onClose: () => void; continuous?: boolean; title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [last, setLast] = useState("");
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const detected = useRef(onDetected);
  const close = useRef(onClose);
  useEffect(() => { detected.current = onDetected; close.current = onClose; }, [onDetected, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const videoElement = videoRef.current;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let zxingControls: { stop: () => void } | null = null;
    // El mismo código leído dos veces seguidas no suma dos veces: hay que sacarlo de cuadro o esperar.
    let lastCode = ""; let lastAt = 0;

    const found = (raw: string) => {
      const code = cleanScannedCode(raw);
      if (!code) return;
      const now = Date.now();
      if (code === lastCode && now - lastAt < 1800) return;
      lastCode = code; lastAt = now;
      scanFeedback(true);
      setLast(code);
      detected.current(code);
      if (!continuous) close.current();
    };

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError("La cámara sólo funciona entrando al sistema por https. Usá el lector de mano o escribí el código.");
        setStarting(false);
        return;
      }
      const video = videoElement!;
      const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
      let formats: string[] = [];
      if (Native) {
        try { formats = (await Native.getSupportedFormats?.()) || FORMATS; } catch { formats = []; }
      }
      try {
        if (Native && formats.length) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          if (stopped) return;
          video.srcObject = stream;
          await video.play();
          trackRef.current = stream.getVideoTracks()[0] || null;
          const detector = new Native({ formats: FORMATS.filter(format => formats.includes(format)) });
          const loop = async () => {
            if (stopped) return;
            try {
              if (video.readyState >= 2) { const [code] = await detector.detect(video); if (code?.rawValue) found(code.rawValue); }
            } catch { /* un cuadro que no se pudo leer */ }
            timer = window.setTimeout(() => { void loop(); }, 180);
          };
          void loop();
        } else {
          // Sin lector del navegador (iPhone, Firefox): zxing lee del mismo video.
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 600 });
          zxingControls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, result => { if (result && !stopped) found(result.getText()); });
          if (stopped) { zxingControls.stop(); return; }
          const media = video.srcObject as MediaStream | null;
          trackRef.current = media?.getVideoTracks()[0] || null;
        }
        const capabilities = (trackRef.current?.getCapabilities?.() || {}) as { torch?: boolean };
        setTorch({ available: !!capabilities.torch, on: false });
      } catch (problem) {
        const name = problem instanceof DOMException ? problem.name : "";
        setError(name === "NotAllowedError" ? "No hay permiso para usar la cámara. Habilitalo en el candado de la barra de direcciones y volvé a abrirla."
          : name === "NotFoundError" ? "Este equipo no tiene cámara. Usá el lector de mano o escribí el código."
          : "No se pudo abrir la cámara. Probá de nuevo o escribí el código.");
      }
      setStarting(false);
    }

    void start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      zxingControls?.stop();
      stream?.getTracks().forEach(track => track.stop());
      const media = videoElement?.srcObject as MediaStream | null;
      media?.getTracks().forEach(track => track.stop());
    };
  }, [continuous]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const on = !torch.on;
    try { await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }); setTorch({ available: true, on }); }
    catch { setTorch({ available: false, on: false }); }
  }

  return <div className="modal-layer scanner-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><Camera /></span><div>
          <p className="eyebrow">CÁMARA</p>
          <h2 id="scanner-title">{title}</h2>
          <small>{continuous ? "Apuntá a cada código: se suman solos. Cerrá cuando termines." : "Apuntá al código de barras"}</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted />
        {!error && <div className="scanner-frame" aria-hidden><span /></div>}
        {starting && !error && <p className="scanner-state">Abriendo la cámara…</p>}
        {error && <p className="scanner-state error">{error}</p>}
      </div>
      <footer>
        <span className="scanner-last">{last ? <><ScanBarcode size={15} /> Último: <b>{last}</b></> : "Todavía no leyó nada"}</span>
        {torch.available && <button type="button" className="secondary-btn" onClick={() => { void toggleTorch(); }}>{torch.on ? <FlashlightOff size={16} /> : <Flashlight size={16} />} Linterna</button>}
        <button type="button" className="primary-btn" onClick={onClose}>{continuous ? "Listo" : "Cancelar"}</button>
      </footer>
    </section>
  </div>;
}
