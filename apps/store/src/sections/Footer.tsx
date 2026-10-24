import { brand } from "../content/site.ts";

export function Footer() {
  const s = brand.socials;
  return (
    <footer className="site-foot">
      <div className="wrap">
        <p>
          © {new Date().getFullYear()} {brand.name} · {brand.city}
        </p>
        <p className="row">
          <a href={s.tiktok} target="_blank" rel="noopener">
            TikTok
          </a>
          <a href={s.instagram} target="_blank" rel="noopener">
            Instagram
          </a>
          <a href={s.facebook} target="_blank" rel="noopener">
            Facebook
          </a>
          <a href={s.linkedin} target="_blank" rel="noopener">
            LinkedIn
          </a>
        </p>
      </div>
    </footer>
  );
}
