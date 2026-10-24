import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import meeple from "../assets/meeple.webp";
import { VipSignup } from "../components/VipSignup.tsx";
import { readKey, writeKey } from "../storage.ts";
import {
  DELAY_SECONDS,
  SCROLL_SHARE,
  parseMemory,
  popupAllowed,
  snoozeUntil,
  type PopupMemory,
} from "./popupRules.ts";

export const MEMORY_KEY = "bbg.vip";
export const SHOWN_KEY = "bbg.vipShown";

const remember = (m: PopupMemory) => writeKey("local", MEMORY_KEY, JSON.stringify(m));

/** Marks the visitor as on the VIP list, so the popup never shows again in this browser. */
export const rememberJoined = () => remember({ joined: true });

export function VipPopup() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const allowed = useCallback(
    () =>
      popupAllowed({
        path: pathname,
        now: Date.now(),
        memory: parseMemory(readKey("local", MEMORY_KEY)),
        shownThisVisit: readKey("session", SHOWN_KEY) === "1",
      }),
    [pathname],
  );

  const show = useCallback(() => {
    if (!allowed()) return;
    writeKey("session", SHOWN_KEY, "1");
    setOpen(true);
  }, [allowed]);

  // Arm the triggers: time on site, half the page scrolled, or (on a computer) the mouse leaving the top.
  useEffect(() => {
    if (open || !allowed()) return;
    const timer = window.setTimeout(show, DELAY_SECONDS * 1000);
    const onScroll = () => {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (room > 0 && window.scrollY / room >= SCROLL_SHARE) show();
    };
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0 && !e.relatedTarget) show();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mouseout", onLeave);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseout", onLeave);
    };
  }, [pathname, open, allowed, show]);

  const close = useCallback(() => {
    setOpen(false);
    if (!joined) remember({ snoozedUntil: snoozeUntil(Date.now()) });
  }, [joined]);

  useEffect(() => {
    if (!open) return;
    // Focus the close button, not the email box, so phones don't throw up a keyboard uninvited.
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  return (
    <div className="popup-backdrop" onClick={close}>
      <div
        className="popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vip-popup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="x" onClick={close} aria-label="Close">
          ×
        </button>
        <img className="meeple" src={meeple} alt="" width="520" height="508" />
        <h2 id="vip-popup-title">Get 10% off the Bearded Bundle.</h2>
        <p>
          Join the VIP list for first dibs on pre-orders and limited runs, plus playtest invites and market
          dates.
        </p>
        <VipSignup
          label="Your email"
          onJoined={() => {
            setJoined(true);
            rememberJoined();
          }}
        />
        {!joined && (
          <button type="button" className="later" onClick={close}>
            Maybe later
          </button>
        )}
      </div>
    </div>
  );
}
