import { useState } from "react";
import { Link } from "react-router";
import type { TeamMember } from "../content/site.ts";
import { useSite } from "../content/SiteProvider.tsx";

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
  const { about, team, text } = useSite();
  return (
    <section className="team" id="beards">
      <div className="wrap pad">
        <h2>{text.teamHeading}</h2>
        <p className="lede">{about}</p>
        <div className="grid">
          {team.map((t) => (
            <article className="card" key={t.id}>
              <Avatar key={t.art} member={t} />
              <h3>{t.name}</h3>
              <p>
                <strong>{t.role}</strong>
              </p>
              <p className="beard">Beard status: {t.beard}</p>
              <p>{t.bio}</p>
              {t.story && t.story.length > 0 && (
                <p>
                  <Link to={`/beards/${t.id}`}>More about {t.name.split(" ")[0]}</Link>
                </p>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
