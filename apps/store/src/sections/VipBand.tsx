import meeple from "../assets/meeple.webp";
import { VipSignup } from "../components/VipSignup.tsx";
import { rememberJoined } from "../vip/VipPopup.tsx";

export function VipBand() {
  return (
    <section className="vip" id="vip">
      <div className="wrap pad">
        <img className="meeple" src={meeple} alt="" width="520" height="508" />
        <div>
          <h2>The Bearded Bundle is coming.</h2>
          <p>
            Three new games for the 2026 holiday season (hopefully — we all have day jobs). Join the VIP list
            for first dibs on pre-orders and 10% off.
          </p>
          <VipSignup onJoined={rememberJoined} />
        </div>
        <ul className="perks">
          <li>
            <strong>10% off</strong> pre-orders
          </li>
          <li>
            <strong>First dibs</strong> on limited runs
          </li>
          <li>
            <strong>Playtest invites</strong> and market dates
          </li>
        </ul>
      </div>
    </section>
  );
}
