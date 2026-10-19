import { useEffect, useRef, useState } from "react";
import { createDeduper, type Detector } from "./detector.ts";

/** Plain words for camera failures. */
export function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access is blocked. Allow the camera for this site in your browser's settings (the camera or lock icon by the address), then try again. You can always type the code instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera found on this device. Type the code, or use a USB or Bluetooth scanner.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
  if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia)
    return "This browser can't use the camera here. Try Chrome, Edge or Safari.";
  return "The camera didn't start. Try again, or type the code.";
}

function feedback() {
  try {
    navigator.vibrate?.(60);
    const Ctx =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1760;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => void ctx.close();
  } catch {
    // Sound and vibration are extras.
  }
}

/**
 * Rear-camera barcode scanner in a panel. Frames are read on the device and never
 * stored or uploaded. `continuous` keeps scanning (count mode); otherwise it closes
 * after the first read.
 */
export function CameraScanner({
  onCode,
  onClose,
  continuous = false,
  title = "Scan with camera",
}: {
  onCode: (code: string) => void;
  onClose: () => void;
  continuous?: boolean;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCodeRef.current = onCode;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const dedupe = createDeduper();

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
        const [{ loadDetector }, media] = await Promise.all([
          import("./detector.ts"),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          }),
        ]);
        stream = media;
        if (stopped) return media.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = media;
        await video.play();
        const track = media.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        if (track && caps?.torch) setTorch({ on: false, track });
        const detector: Detector = await loadDetector();
        setStarting(false);

        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const found = await detector.detect(video);
              const code = found[0]?.rawValue?.trim();
              if (code && dedupe(code, performance.now())) {
                feedback();
                setLastRead(code);
                onCodeRef.current(code);
                if (!continuous) return onCloseRef.current();
              }
            }
          } catch (err) {
            // The reader itself won't work here: say so instead of scanning forever.
            if ((err as { name?: string })?.name === "NotSupportedError") {
              setError(
                "The barcode reader couldn't start on this device. Type the code, or use a USB or Bluetooth scanner.",
              );
              return;
            }
            // Otherwise it's one frame that can't be read; try the next one.
          }
          timer = setTimeout(tick, 120);
        };
        void tick();
      } catch (err) {
        setStarting(false);
        setError(cameraErrorMessage(err));
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [continuous]);

  async function toggleTorch() {
    if (!torch) return;
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch({ ...torch, on: !torch.on });
    } catch {
      setTorch(null);
    }
  }

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scanner-head">
        <b>{title}</b>
        <div className="actions">
          {torch && (
            <button type="button" onClick={() => void toggleTorch()}>
              {torch.on ? "Light off" : "Light on"}
            </button>
          )}
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {error ? (
        <p className="error-box" role="alert">
          {error}
        </p>
      ) : (
        <div className="scanner-view">
          <video ref={videoRef} muted playsInline aria-label="Camera view" />
          <div className="scanner-guide" aria-hidden="true" />
          <p className="scanner-hint" role="status">
            {starting
              ? "Starting the camera…"
              : lastRead
                ? `Read ${lastRead}${continuous ? ". Scan the next item." : ""}`
                : "Hold the barcode inside the box"}
          </p>
        </div>
      )}
      <p className="muted small">Camera images stay on this device. Nothing is saved or uploaded.</p>
    </div>
  );
}

/** A "Scan with camera" button that opens the scanner. */
export function CameraButton({
  onCode,
  continuous,
  label = "Scan with camera",
  title,
}: {
  onCode: (code: string) => void;
  continuous?: boolean;
  label?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} title={label}>
        {label}
      </button>
      {open && (
        <CameraScanner onCode={onCode} onClose={() => setOpen(false)} continuous={continuous} title={title} />
      )}
    </>
  );
}
