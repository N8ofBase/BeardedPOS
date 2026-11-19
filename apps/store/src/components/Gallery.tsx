import type { Picture } from "../content/site.ts";

/** A row of photos. Each opens full size in a new tab. */
export function Gallery({ pictures, label }: { pictures: Picture[]; label: string }) {
  return (
    <ul className="gallery" aria-label={label}>
      {pictures.map((p) => (
        <li key={p.src}>
          <figure>
            <a href={p.full} target="_blank" rel="noopener">
              <img src={p.src} alt={p.alt} loading="lazy" />
            </a>
            {p.caption && <figcaption>{p.caption}</figcaption>}
          </figure>
        </li>
      ))}
    </ul>
  );
}
