import { Link, useParams } from "react-router";
import { useSite } from "../content/SiteProvider.tsx";
import { NotFound } from "./NotFound.tsx";

/** One of the beards, with the full bio from the old site. Only people with a full bio have a page. */
export function BeardPage() {
  const { id } = useParams();
  const { team } = useSite();
  const member = team.find((m) => m.id === id);
  if (!member?.story?.length) return <NotFound />;
  return (
    <article className="wrap pad beard-page">
      <p className="crumbs">
        <Link to="/#beards">Meet the beards</Link>
      </p>
      <header>
        {member.art && <img className="av" src={member.art} alt={member.name} />}
        <div>
          <h1>{member.name}</h1>
          <p className="lede">{member.role}</p>
          <p className="beard">Beard status: {member.beard}</p>
        </div>
      </header>
      <div className="story">
        {member.story.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      {member.links && (
        <p className="links">
          {member.links.map((l) => (
            <Link key={l.href} className="btn" to={l.href}>
              {l.label}
            </Link>
          ))}
        </p>
      )}
    </article>
  );
}
