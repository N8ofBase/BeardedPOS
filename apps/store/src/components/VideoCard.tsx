import type { SyntheticEvent } from "react";
import type { Video } from "../content/site.ts";

const length = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Only one song plays at a time: starting one pauses the rest. */
function pauseOthers(e: SyntheticEvent<HTMLVideoElement>) {
  for (const v of document.querySelectorAll<HTMLVideoElement>("video.song"))
    if (v !== e.currentTarget) v.pause();
}

export function VideoCard({ video, heading = "h3" }: { video: Video; heading?: "h2" | "h3" }) {
  const H = heading;
  return (
    <figure className="video" id={video.slug}>
      <figcaption>
        <H>{video.title}</H>
        <p>
          {video.blurb} <span className="len">{length(video.seconds)}</span>
        </p>
      </figcaption>
      <video
        className="song"
        src={video.src}
        poster={video.poster}
        width={720}
        height={1280}
        controls
        playsInline
        preload="none"
        aria-label={`${video.title}, ${length(video.seconds)}`}
        onPlay={pauseOthers}
      />
    </figure>
  );
}
