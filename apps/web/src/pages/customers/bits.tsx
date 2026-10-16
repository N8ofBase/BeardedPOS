// Small pieces shared by the customer cards and profile.
import { ageText, birthdayTag, formatDate, SPECIES_LABEL } from "@pet-pos/core";
import type { PetSummary, PunchCard } from "@pet-pos/api";

export function BirthdayTag({ birthday, who }: { birthday: string | null; who?: string }) {
  const tag = birthdayTag(birthday);
  return tag ? <span className="tag low">{who ? `${who}'s ${tag}` : tag}</span> : null;
}

export function PetChip({ pet }: { pet: PetSummary }) {
  const bits = [SPECIES_LABEL[pet.species], pet.breed, ageText(pet.birthday)].filter(Boolean);
  return (
    <>
      <span className="petchip">
        <b>{pet.name}</b>
        {bits.length > 0 && <span className="k">{bits.join(" · ")}</span>}
        {pet.birthday && <span className="k">· born {formatDate(pet.birthday)}</span>}
      </span>
      <BirthdayTag birthday={pet.birthday} who={pet.name} />
    </>
  );
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
