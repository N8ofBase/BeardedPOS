import type { ReactNode } from "react";

/** Placeholder for a screen that later sessions build. Says plainly what's coming and when. */
export function ComingSoon({
  title,
  phase,
  children,
}: {
  title: string;
  phase: number;
  children: ReactNode;
}) {
  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <section className="panel">
        <h2>{phase === 1 ? "Coming next in Phase 1" : `Coming in Phase ${phase}`}</h2>
        <p className="muted">{children}</p>
        <p className="muted">
          To see how it will work, open the <a href="/prototype.html">clickable prototype</a>.
        </p>
      </section>
    </>
  );
}
