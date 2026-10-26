import { useState } from "react";
import { about, team, type TeamMember } from "../content/site.ts";

const initials = (name: string) =>
  name
    .replace(/“.*”\s/, "")
    .split(" ")
    .map((w) => w[0])
    .join("");

function Avatar({ member }: { member: TeamMember }) {
  const [broken, setBroken] = useState(false);
  if (!member.art || broken)
    return (
      <div className="av" aria-hidden="true">
        {initials(member.name)}
      </div>
    );
  return <img className="av" src={member.art} alt={member.name} onError={() => setBroken(true)} />;
}

export function Beards() {
  return (
    <section className="team" id="beards">
      <div className="wrap pad">
        <h2>Meet the beards.</h2>
        <p className="lede">{about}</p>
        <div className="grid">
          {team.map((t) => (
            <article className="card" key={t.name}>
              <Avatar member={t} />
              <h3>{t.name}</h3>
              <p>
                <strong>{t.role}</strong>
              </p>
              <p className="beard">Beard status: {t.beard}</p>
              <p>{t.bio}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
