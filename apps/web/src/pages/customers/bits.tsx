// Small pieces shared by the customer cards and profile.
import { birthdayTag } from "@pet-pos/core";

export function BirthdayTag({ birthday, who }: { birthday: string | null; who?: string }) {
  const tag = birthdayTag(birthday);
  return tag ? <span className="tag low">{who ? `${who}'s ${tag}` : tag}</span> : null;
}
