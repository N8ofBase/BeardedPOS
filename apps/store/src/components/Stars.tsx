/** Read-only stars, e.g. 4.5 → ★★★★½ with a label screen readers can say. */
export function Stars({ value, size = "1rem" }: { value: number; size?: string }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="stars" role="img" aria-label={`${value} out of 5 stars`} style={{ fontSize: size }}>
      <span className="stars-empty" aria-hidden="true">
        ★★★★★
      </span>
      <span className="stars-full" aria-hidden="true" style={{ width: `${pct}%` }}>
        ★★★★★
      </span>
    </span>
  );
}
