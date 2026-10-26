import { VideoCard } from "../components/VideoCard.tsx";
import { videos } from "../content/site.ts";

export function VideosPage() {
  return (
    <section className="wrap pad videos-page">
      <h1>Songs from the shop.</h1>
      <p className="lede">
        N8 writes board game parody songs and plays them on the bass. They’re our commercials. Turn the sound
        up.
      </p>
      <div className="videos">
        {videos.map((v) => (
          <VideoCard key={v.slug} video={v} heading="h2" />
        ))}
      </div>
    </section>
  );
}
