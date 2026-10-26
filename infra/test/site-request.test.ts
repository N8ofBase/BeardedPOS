import { describe, expect, it } from "vitest";
import { oldSiteRedirects } from "../../packages/store-core/src/oldSite.ts";
import { viewerRequestCode } from "../lib/site-request.ts";

type Request = { uri: string };
type Redirect = { statusCode: number; headers: { location: { value: string } } };

const handler = new Function(`${viewerRequestCode(oldSiteRedirects)}\nreturn handler;`)() as (event: {
  request: Request;
}) => Request | Redirect;
const run = (uri: string) => handler({ request: { uri } });

describe("store site request function", () => {
  it("sends old Squarespace links to their new pages, ignoring case and a trailing slash", () => {
    expect(run("/Fences/")).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "/games/fences" } },
    });
    expect(run("/shop/locked-out")).toMatchObject({ headers: { location: { value: "/games/locked-out" } } });
    expect(run("/home")).toMatchObject({ headers: { location: { value: "/" } } });
  });

  it("loads the app for its own routes and leaves files alone", () => {
    expect(run("/games/fences")).toEqual({ uri: "/index.html" });
    expect(run("/")).toEqual({ uri: "/index.html" });
    expect(run("/videos/beer-ded-board-games.mp4")).toEqual({ uri: "/videos/beer-ded-board-games.mp4" });
    expect(run("/assets/index-abc.js")).toEqual({ uri: "/assets/index-abc.js" });
  });
});
