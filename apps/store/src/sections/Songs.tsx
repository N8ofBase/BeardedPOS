import { Link } from "react-router";
import { VideoCard } from "../components/VideoCard.tsx";
import { videos } from "../content/site.ts";

/** The newest songs on the home page; /videos has them all. */
export function Songs() {
  return (
    <section className="songs" id="songs">
      <div className="wrap pad">
        <h2>Songs from the shop.</h2>
        <p className="lede">Board game parody songs, written and played by N8. Our kind of commercial.</p>
        <div className="videos">
          {videos.slice(0, 3).map((v) => (
            <VideoCard key={v.slug} video={v} />
          ))}
        </div>
        <Link className="btn" to="/videos">
          All the videos
        </Link>
      </div>
    </section>
  );
}
