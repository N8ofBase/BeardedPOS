import { Link } from "react-router";
import {
  bucksLabel,
  formatCents,
  MIN_REWARD_ORDER_CENTS,
  REWARD_CENTS,
  WELCOME_BUCKS,
} from "@bearded/store-core";
import meeple from "../assets/meeple.webp";
import { BuddySignIn } from "../buddy/BuddySignIn.tsx";
import { useSignedIn } from "../buddy/BuddyProvider.tsx";
import { rememberJoined } from "../buddy/BuddyPopup.tsx";

export function BuddyBand() {
  const account = useSignedIn();
  return (
    <section className="vip" id="buddy">
      <div className="wrap pad">
        <img className="meeple" src={meeple} alt="" width="520" height="508" />
        <div>
          <h2>Join Beard Buddy. Get {formatCents(REWARD_CENTS)} off now.</h2>
          <p>
            Sign up and we add {WELCOME_BUCKS} Beard Bucks, ready for your first order of{" "}
            {formatCents(MIN_REWARD_ORDER_CENTS)} or more. The Bearded Bundle is coming for the 2026 holiday
            season (hopefully — we all have day jobs), and Beard Buddies hear first.
          </p>
          {account ? (
            <p className="joined" role="status">
              You’re a Beard Buddy with {bucksLabel(account.balance)}.{" "}
              <Link to="/account">See your Bucks</Link>
            </p>
          ) : (
            <BuddySignIn
              intro="Enter your email and we’ll send a 6-digit code. Signing in is joining."
              onSignedIn={rememberJoined}
            />
          )}
        </div>
        <ul className="perks">
          <li>
            <strong>{formatCents(REWARD_CENTS)} off</strong> when you join
          </li>
          <li>
            <strong>1 Buck</strong> for every dollar
          </li>
          <li>
            <strong>First dibs</strong> on the Bearded Bundle
          </li>
        </ul>
      </div>
    </section>
  );
}
