// Small pieces shared by the customer cards and profile.
import { birthdayTag } from "@pet-pos/core";
import type { PunchCard } from "@pet-pos/api";

export function BirthdayTag({ birthday, who }: { birthday: string | null; who?: string }) {
  const tag = birthdayTag(birthday);
  return tag ? <span className="tag low">{who ? `${who}'s ${tag}` : tag}</span> : null;
}

export function Punches({ card }: { card: PunchCard }) {
  const n = Math.min(card.balance, card.buyCount);
  return (
    <div className="small">
      <span className="astro-name">{card.programName}</span>{" "}
      <span className="num muted">
        {card.balance}/{card.buyCount}
      </span>{" "}
      <span className="punch" aria-label={`${card.balance} of ${card.buyCount}`}>
        {Array.from({ length: card.buyCount }, (_, i) => (
          <i key={i} className={i < n ? "on" : ""} />
        ))}
      </span>
      {card.balance >= card.buyCount && <span className="tag astro"> Reward ready: {card.rewardText}</span>}
    </div>
  );
}
