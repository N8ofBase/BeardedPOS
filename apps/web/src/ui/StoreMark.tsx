/** The store's logo, or its first letter when there isn't one. */
export function StoreMark({ name, logo, color }: { name: string; logo: string | null; color: string }) {
  return logo ? (
    <img src={logo} alt={`${name} logo`} className="store-logo" />
  ) : (
    <span className="store-logo initial" style={{ borderColor: color }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
