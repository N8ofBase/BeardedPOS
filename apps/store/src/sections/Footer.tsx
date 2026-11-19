import { useSite } from "../content/SiteProvider.tsx";

export function Footer() {
  const { brand } = useSite();
  const s = brand.socials;
  const m = brand.memberships;
  return (
    <footer className="site-foot">
      <div className="wrap">
        <img className="badge" src={m.gama.src} alt={m.gama.label} width="96" height="113" loading="lazy" />
        <div className="middle">
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
          <p>
            © {new Date().getFullYear()} {brand.name} · {brand.city}
          </p>
        </div>
        <a className="badge" href={m.iga.href} target="_blank" rel="noopener">
          <img src={m.iga.src} alt={m.iga.label} width="88" height="131" loading="lazy" />
        </a>
      </div>
    </footer>
  );
}
