import { useState } from "react";
import { useLocation } from "react-router";
import { Calendar } from "./Calendar.tsx";
import { GroomersView } from "./GroomersView.tsx";
import { ServicesView } from "./ServicesView.tsx";

type View = "calendar" | "services" | "groomers";

function savedView(): View {
  try {
    const v = localStorage.getItem("grooming.view");
    if (v === "services" || v === "groomers") return v;
  } catch {
    // Storage can be blocked; the calendar is the default.
  }
  return "calendar";
}

export function GroomingPage() {
  const location = useLocation();
  const bookFor = (location.state as { bookFor?: string } | null)?.bookFor ?? null;
  const [view, setView] = useState<View>(bookFor ? "calendar" : savedView);

  function pick(v: View) {
    setView(v);
    try {
      localStorage.setItem("grooming.view", v);
    } catch {
      // Remembering the tab is only a convenience.
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Grooming</h1>
        <a href="/book" className="small" title="What customers see when they book online">
          Open booking page
        </a>
        <div className="seg" role="group" aria-label="Grooming views">
          {(["calendar", "services", "groomers"] as View[]).map((v) => (
            <button type="button" key={v} aria-pressed={view === v} onClick={() => pick(v)}>
              {v === "calendar" ? "Calendar" : v === "services" ? "Services" : "Groomers"}
            </button>
          ))}
        </div>
      </div>
      {view === "calendar" && <Calendar bookFor={bookFor} />}
      {view === "services" && <ServicesView />}
      {view === "groomers" && <GroomersView />}
    </>
  );
}
