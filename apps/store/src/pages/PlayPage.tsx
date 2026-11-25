// A web game just for Beard Buddies. Signed in, the Play button opens the game (the server checks the
// Buddy session again before sending it); a guest signs in here first, and signing in is joining.
import type { CSSProperties } from "react";
import { Link, useParams } from "react-router";
import { formatCents, REWARD_CENTS, WELCOME_BUCKS } from "@bearded/store-core";
import { useBuddy } from "../buddy/BuddyProvider.tsx";
import { BuddySignIn } from "../buddy/BuddySignIn.tsx";
import { useSite } from "../content/SiteProvider.tsx";
import { NotFound } from "./NotFound.tsx";

export function PlayPage() {
  const { slug } = useParams();
  const { games } = useSite();
  const { account } = useBuddy();
  const game = games.find((g) => g.slug === slug && g.playOnline);
  if (!game) return <NotFound />;

  return (
    <section className="wrap pad play-page" style={{ "--c": game.color } as CSSProperties}>
      <p className="crumbs">
        <Link to={`/games/${game.slug}`}>{game.name}</Link>
      </p>
      <div className="play-card">
        <img src={game.art} alt={`${game.name} box art`} />
        <div>
          <h1>Play {game.name} online</h1>
          <p className="lede">
            Free for Beard Buddies. Play solo against the computer, right in your browser.
          </p>
          {account.state === "loading" && <p>Checking your account…</p>}
          {account.state === "failed" && (
            <p>We couldn’t reach the store server. Refresh the page to try again.</p>
          )}
          {account.state === "ready" &&
            (account.value ? (
              <>
                <a className="btn go big" href={`/api/play/${game.slug}`}>
                  Play {game.name}
                </a>
                <p className="fine">
                  Signed in as {account.value.email}. Your games and settings save in this browser.
                </p>
              </>
            ) : (
              <BuddySignIn
                intro={`${game.name} online is just for Beard Buddies, and joining is free. Enter your email and we’ll send a 6-digit code. New Buddies also get ${WELCOME_BUCKS} Beard Bucks (${formatCents(REWARD_CENTS)} off).`}
              />
            ))}
        </div>
      </div>
    </section>
  );
}
