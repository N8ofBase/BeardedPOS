import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { formatCents, MIN_REWARD_ORDER_CENTS, REWARD_CENTS, WELCOME_BUCKS } from "@bearded/store-core";
import meeple from "../assets/meeple.webp";
import { readKey, writeKey } from "../storage.ts";
import { useTracker } from "../track/Tracker.tsx";
import { BuddySignIn } from "./BuddySignIn.tsx";
import { useSignedIn } from "./BuddyProvider.tsx";
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

/** Marks the visitor as a Beard Buddy, so the popup never shows again in this browser. */
export const rememberJoined = () => remember({ joined: true });

export function BuddyPopup() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { track } = useTracker();
  const signedIn = useSignedIn() !== null;

  const allowed = useCallback(
    () =>
      !signedIn &&
      popupAllowed({
        path: pathname,
        now: Date.now(),
        memory: parseMemory(readKey("local", MEMORY_KEY)),
        shownThisVisit: readKey("session", SHOWN_KEY) === "1",
      }),
    [pathname, signedIn],
  );

  const show = useCallback(() => {
    if (!allowed()) return;
    writeKey("session", SHOWN_KEY, "1");
    setOpen(true);
    track({ type: "popup_shown" });
  }, [allowed, track]);

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
    if (!joined) {
      remember({ snoozedUntil: snoozeUntil(Date.now()) });
      track({ type: "popup_closed" });
    }
  }, [joined, track]);

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
        aria-labelledby="buddy-popup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="x" onClick={close} aria-label="Close">
          ×
        </button>
        <img className="meeple" src={meeple} alt="" width="520" height="508" />
        <h2 id="buddy-popup-title">Join Beard Buddy. Get {formatCents(REWARD_CENTS)} off now.</h2>
        {joined ? (
          <p role="status">
            Welcome, Beard Buddy! {WELCOME_BUCKS} Beard Bucks are yours. Use them on any order of{" "}
            {formatCents(MIN_REWARD_ORDER_CENTS)} or more.
          </p>
        ) : (
          <>
            <p>
              Sign up and we add {WELCOME_BUCKS} Beard Bucks, ready for your first order of{" "}
              {formatCents(MIN_REWARD_ORDER_CENTS)} or more. You also earn 1 Buck for every dollar and hear
              first about the Bearded Bundle.
            </p>
            <BuddySignIn
              intro="Enter your email and we’ll send a 6-digit code."
              onSignedIn={() => {
                setJoined(true);
                rememberJoined();
                track({ type: "popup_joined" });
              }}
            />
          </>
        )}
        {!joined && (
          <button type="button" className="later" onClick={close}>
            Maybe later
          </button>
        )}
      </div>
    </div>
  );
}
