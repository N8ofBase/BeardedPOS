import { useEffect, type ReactNode } from "react";

/** Editing panel from the right, as in Shopify's admin. Escape or the backdrop closes it. */
export function SlideOver({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="slideover" role="dialog" aria-modal="true" aria-label={title}>
        <div className="head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
