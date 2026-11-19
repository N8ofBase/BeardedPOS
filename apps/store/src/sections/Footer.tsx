import { useSite } from "../content/SiteProvider.tsx";

export function Footer() {
  const { brand } = useSite();
  const s = brand.socials;
  const m = brand.memberships;
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
        <p className="row badges">
          <img src={m.gama.src} alt={m.gama.label} width="40" height="47" loading="lazy" />
          <a href={m.iga.href} target="_blank" rel="noopener">
            {m.iga.label}
          </a>
        </p>
      </div>
    </footer>
  );
}
