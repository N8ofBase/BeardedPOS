import { useEffect, useRef, useState } from "react";
import meeple from "../assets/meeple.webp";
import { brand } from "../content/site.ts";
import { roll, type Link, type RollResult } from "../roll.ts";

const COLORS = ["#F6B820", "#FFD25E", "#E8463A", "#E6F2EE", "#7BAE4E", "#3B5BA9", "#FFFFFF", "#8E5BC2"];

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function RollLink({ link }: { link: Link }) {
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener">
      {link.label}
    </a>
  ) : (
    <a href={link.href}>{link.label}</a>
  );
}

export function Hero() {
  const [result, setResult] = useState<RollResult | null>(null);
  const [face, setFace] = useState(20);
  const [motion, setMotion] = useState("");
  const heroRef = useRef<HTMLElement>(null);
  const dieRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function fireworks() {
    const hero = heroRef.current,
      die = dieRef.current,
      fx = fxRef.current;
    if (reducedMotion() || !hero || !die || !fx || !fx.animate) return;
    const h = hero.getBoundingClientRect(),
      d = die.getBoundingClientRect();
    [0, 350, 700].forEach((delay, b) => {
      const cx = d.left - h.left + d.width * (0.5 + (b - 1) * 0.35);
      const cy = d.top - h.top + d.height * (0.35 + b * 0.1);
      for (let k = 0; k < 34; k++) {
        const p = document.createElement("i");
        const a = Math.random() * Math.PI * 2,
          r = 80 + Math.random() * 150;
        p.style.left = `${cx}px`;
        p.style.top = `${cy}px`;
        p.style.background = COLORS[k % COLORS.length]!;
        fx.appendChild(p);
        p.animate(
          [
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r + 60}px) scale(.3)`, opacity: 0 },
          ],
          { duration: 1100 + Math.random() * 500, delay, easing: "cubic-bezier(.1,.7,.3,1)", fill: "both" },
        ).onfinish = () => p.remove();
      }
    });
  }

  function onRoll() {
    const last = result && "name" in result ? result.name : undefined;
    const next = roll(Math.random, last);
    setMotion("");
    // Restart the tumble animation on the next frame.
    requestAnimationFrame(() =>
      setMotion(next.kind === "botch" ? "botch" : next.kind === "crit" ? "crit" : "rolling"),
    );
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        setFace(next.face);
        setResult(next);
        if (next.kind === "crit") fireworks();
      },
      reducedMotion() ? 0 : 650,
    );
  }

  return (
    <section className="hero" ref={heroRef} id="top">
      <div className="wrap">
        <div>
          <div className="mark">
            <img src={meeple} alt="" width="520" height="508" />
            <span>{brand.name}</span>
          </div>
          <h1>{brand.motto}</h1>
          <p className="lede">
            We make quick, fun games that are easy to teach and hard to put down. Made by people who play WAY
            too many games. Your next game night starts here.
          </p>
          <div className="row">
            <a className="btn go" href="#shop">
              Shop the games
            </a>
            <a className="btn" href="#vip">
              Get 10% off the Bearded Bundle
            </a>
          </div>
        </div>
        <div className="roller">
          <button
            ref={dieRef}
            className={`d20 ${motion}`}
            type="button"
            aria-label="Roll the die to pick a game for tonight"
            aria-describedby="roll-result"
            onClick={onRoll}
          >
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <polygon
                points="100,6 182,53 182,147 100,194 18,147 18,53"
                fill="#F6B820"
                stroke="#1E2421"
                strokeWidth="5"
                strokeLinejoin="round"
              />
              <polygon
                points="100,52 150,138 50,138"
                fill="#FFD25E"
                stroke="#1E2421"
                strokeWidth="4"
                strokeLinejoin="round"
              />
              <g stroke="#1E2421" strokeWidth="4" strokeLinecap="round" fill="none">
                <line x1="100" y1="6" x2="100" y2="52" />
                <line x1="18" y1="53" x2="100" y2="52" />
                <line x1="182" y1="53" x2="100" y2="52" />
                <line x1="18" y1="53" x2="50" y2="138" />
                <line x1="182" y1="53" x2="150" y2="138" />
                <line x1="18" y1="147" x2="50" y2="138" />
                <line x1="182" y1="147" x2="150" y2="138" />
                <line x1="100" y1="194" x2="50" y2="138" />
                <line x1="100" y1="194" x2="150" y2="138" />
              </g>
              <text x="100" y="118" textAnchor="middle" className="face">
                {face}
              </text>
            </svg>
          </button>
          <p className="result" id="roll-result" aria-live="polite">
            {!result && "Tap it to roll for tonight’s game."}
            {result?.kind === "botch" && (
              <>
                <strong>Critical failure.</strong>
                {result.text}
              </>
            )}
            {result?.kind === "crit" && (
              <>
                <strong>Natural 20!</strong>
                <b className="must">YOU MUST BUY THEM ALL!</b>
                {result.text}
                <span className="all">
                  {result.links.map((l) => (
                    <RollLink key={l.href} link={l} />
                  ))}
                </span>
              </>
            )}
            {(result?.kind === "game" || result?.kind === "social") && (
              <>
                {result.text} <RollLink link={result.link} />
              </>
            )}
          </p>
        </div>
      </div>
      <div className="fx" ref={fxRef} aria-hidden="true" />
    </section>
  );
}
