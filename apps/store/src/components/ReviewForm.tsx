import { useId, useState, type FormEvent } from "react";
import { errorText, useStore } from "../api/store.ts";
import { games } from "../content/site.ts";
import { isBot, LIMITS, validateReview, type ReviewErrors, type ReviewInput } from "@bearded/store-core";
import { useTracker } from "../track/Tracker.tsx";
import { rememberJoined } from "../vip/VipPopup.tsx";

const blank = (game: string): ReviewInput => ({
  game,
  stars: 0,
  headline: "",
  body: "",
  name: "",
  email: "",
  joinVip: false,
  website: "",
});

/** The review form. On a game page `game` is set and the game picker is hidden. */
export function ReviewForm({ game }: { game?: string }) {
  const store = useStore();
  const { track } = useTracker();
  const id = useId();
  const [input, setInput] = useState<ReviewInput>(() => blank(game ?? ""));
  const [errors, setErrors] = useState<ReviewErrors>({});
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [failure, setFailure] = useState("");
  const set = <K extends keyof ReviewInput>(k: K, v: ReviewInput[K]) => setInput((i) => ({ ...i, [k]: v }));
  const gameName = games.find((g) => g.slug === input.game)?.name;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateReview(
      input,
      games.map((g) => g.slug),
    );
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setState("sending");
    try {
      if (!isBot(input)) {
        await store.submitReview({
          ...input,
          headline: input.headline.trim(),
          body: input.body.trim(),
          name: input.name.trim(),
          email: input.email.trim(),
        });
        if (input.joinVip) rememberJoined();
        track({ type: "review_sent", label: input.game });
      }
      setState("sent");
    } catch (e) {
      setFailure(errorText(e, "That didn’t go through. Try again in a minute."));
      setState("failed");
    }
  }

  if (state === "sent")
    return (
      <div className="review-sent" role="status">
        <h3>Thanks for the review!</h3>
        <p>
          The beards read every one. It will show {gameName ? `on the ${gameName} page` : "here"} once someone
          on the team approves it, usually within a few days.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setInput(blank(game ?? ""));
            setState("idle");
          }}
        >
          Write another
        </button>
      </div>
    );

  const field = (k: keyof ReviewErrors) =>
    errors[k] ? { "aria-invalid": true as const, "aria-describedby": `${id}-${k}-error` } : {};
  const err = (k: keyof ReviewErrors) =>
    errors[k] && (
      <p className="error" id={`${id}-${k}-error`}>
        {errors[k]}
      </p>
    );

  return (
    <form className="review-form" onSubmit={onSubmit} noValidate>
      {!game && (
        <div className="field">
          <label htmlFor={`${id}-game`}>Game</label>
          <select
            id={`${id}-game`}
            value={input.game}
            onChange={(e) => set("game", e.target.value)}
            {...field("game")}
          >
            <option value="">Pick a game</option>
            {games.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
          {err("game")}
        </div>
      )}
      <fieldset className="field star-pick" {...field("stars")}>
        <legend>Your rating</legend>
        <div className="row">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={n <= input.stars ? "on" : ""}>
              <input
                type="radio"
                name={`${id}-stars`}
                value={n}
                checked={input.stars === n}
                onChange={() => set("stars", n)}
              />
              <span aria-hidden="true">★</span>
              <span className="sr">
                {n} star{n > 1 ? "s" : ""}
              </span>
            </label>
          ))}
        </div>
        {err("stars")}
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-headline`}>
          Headline <span className="opt">(optional)</span>
        </label>
        <input
          id={`${id}-headline`}
          maxLength={LIMITS.headline}
          value={input.headline}
          onChange={(e) => set("headline", e.target.value)}
          {...field("headline")}
        />
        {err("headline")}
      </div>
      <div className="field">
        <label htmlFor={`${id}-body`}>Your review</label>
        <textarea
          id={`${id}-body`}
          rows={5}
          maxLength={LIMITS.body}
          value={input.body}
          onChange={(e) => set("body", e.target.value)}
          {...field("body")}
        />
        <p className="hint">
          {input.body.length} of {LIMITS.body} characters
        </p>
        {err("body")}
      </div>
      <div className="row two">
        <div className="field">
          <label htmlFor={`${id}-name`}>First name and last initial</label>
          <input
            id={`${id}-name`}
            autoComplete="name"
            maxLength={LIMITS.name}
            placeholder="Sam R."
            value={input.name}
            onChange={(e) => set("name", e.target.value)}
            {...field("name")}
          />
          {err("name")}
        </div>
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            value={input.email}
            onChange={(e) => set("email", e.target.value)}
            {...field("email")}
          />
          <p className="hint">Never shown. We use it to say thanks and to mark “Bought from us”.</p>
          {err("email")}
        </div>
      </div>
      <div className="trap" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Website</label>
        <input
          id={`${id}-website`}
          tabIndex={-1}
          autoComplete="off"
          value={input.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={input.joinVip} onChange={(e) => set("joinVip", e.target.checked)} />
        Join the VIP list too (10% off pre-orders)
      </label>
      <button className="btn red" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send review"}
      </button>
      {state === "failed" && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
    </form>
  );
}
