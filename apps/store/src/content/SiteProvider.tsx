// Shares the site's wording with every screen: the original wording at once, then whatever staff
// published (GET /api/site) once it loads. In draft preview (opened from Behind the Beard) a signed-in
// staff member sees the saved draft instead, with a bar that says so; shoppers never do.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import type { SiteContent } from "@bearded/store-core";
import { useStore } from "../api/store.ts";
import { readKey, writeKey } from "../storage.ts";
import { buildSite, type Site } from "./editable.ts";

/** Session storage key: this tab is previewing the draft. */
export const PREVIEW_KEY = "bbg.site-preview";
export const isPreviewing = () => readKey("session", PREVIEW_KEY) === "draft";

interface SiteState {
  site: Site;
  previewing: boolean;
  reload(): void;
  stopPreview(): void;
}

const ORIGINAL = buildSite({});
const SiteContext = createContext<SiteState>({
  site: ORIGINAL,
  previewing: false,
  reload: () => {},
  stopPreview: () => {},
});

export const useSite = () => useContext(SiteContext).site;
export const useSitePreview = () => useContext(SiteContext);

export function SiteProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const { search } = useLocation();
  // "?preview=draft" on the first page turns preview on for this tab, so it lasts as staff click around.
  const [previewing, setPreviewing] = useState(() => {
    if (new URLSearchParams(search).get("preview") === "draft") writeKey("session", PREVIEW_KEY, "draft");
    return isPreviewing();
  });
  const [content, setContent] = useState<SiteContent>({});
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    let live = true;
    const published = () =>
      store.site().then(
        (s) => live && setContent(s.content),
        () => {}, // The original wording stays up.
      );
    if (!previewing) void published();
    else
      store.staff.site().then(
        (s) => live && setContent(s.draft),
        () => {
          // Signed out (or the server is away): show the live site and stop previewing.
          writeKey("session", PREVIEW_KEY, null);
          if (live) setPreviewing(false);
        },
      );
    return () => {
      live = false;
    };
  }, [store, previewing, loads]);

  const reload = useCallback(() => setLoads((n) => n + 1), []);
  const stopPreview = useCallback(() => {
    writeKey("session", PREVIEW_KEY, null);
    setPreviewing(false);
  }, []);
  const site = useMemo(() => buildSite(content), [content]);
  const value = useMemo(
    () => ({ site, previewing, reload, stopPreview }),
    [site, previewing, reload, stopPreview],
  );
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** Across the top of every page while staff preview the draft. */
export function PreviewBar() {
  const { previewing, reload, stopPreview } = useSitePreview();
  if (!previewing) return null;
  return (
    <div className="preview-bar" role="status" data-no-track>
      <p>
        <strong>Draft preview.</strong> Only you see this. Shoppers still see the live site.
      </p>
      <p className="row">
        <button type="button" className="btn" onClick={reload}>
          Show my latest saved draft
        </button>
        <Link className="btn" to="/behind-the-beard">
          Back to the editor
        </Link>
        <button type="button" className="btn" onClick={stopPreview}>
          Stop previewing
        </button>
      </p>
    </div>
  );
}

/** The announcement bar staff set in Site content, on every page. */
export function NoticeBar() {
  const { notice } = useSite();
  if (!notice) return null;
  const external = notice.link?.startsWith("https://");
  return (
    <div className="notice-bar">
      <p>
        {!notice.link ? (
          notice.text
        ) : external ? (
          <a href={notice.link} target="_blank" rel="noopener">
            {notice.text}
          </a>
        ) : (
          <Link to={notice.link}>{notice.text}</Link>
        )}
      </p>
    </div>
  );
}
