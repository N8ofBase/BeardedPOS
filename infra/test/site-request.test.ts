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

  it("loads the register's own app under /register", () => {
    expect(run("/register")).toEqual({ uri: "/register/index.html" });
    expect(run("/register/")).toEqual({ uri: "/register/index.html" });
    expect(run("/register/inventory/new")).toEqual({ uri: "/register/index.html" });
    expect(run("/register/assets/index-abc.js")).toEqual({ uri: "/register/assets/index-abc.js" });
    expect(run("/registered")).toEqual({ uri: "/index.html" });
  });
});

describe("store site request function with the shop's own domain", () => {
  type Req = { uri: string; headers?: Record<string, { value: string }>; querystring?: unknown };
  const canonical = new Function(
    `${viewerRequestCode(oldSiteRedirects, "beardedboardgames.com")}\nreturn handler;`,
  )() as (event: { request: Req }) => Req | Redirect;
  const at = (host: string, uri: string, querystring = {}) =>
    canonical({ request: { uri, headers: { host: { value: host } }, querystring } });

  it("sends www and the prismcortex.net name to the same page on the main address", () => {
    expect(at("www.beardedboardgames.com", "/games/fences")).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "https://beardedboardgames.com/games/fences" } },
    });
    expect(
      at("bbg-live.prismcortex.net", "/thanks", { order: { value: "abc" }, preview: { value: "" } }),
    ).toMatchObject({
      headers: { location: { value: "https://beardedboardgames.com/thanks?order=abc&preview" } },
    });
    expect(
      at("WWW.BeardedBoardGames.com", "/register", {
        a: { value: "1", multiValue: [{ value: "1" }, { value: "2" }] },
      }),
    ).toMatchObject({ headers: { location: { value: "https://beardedboardgames.com/register?a=1&a=2" } } });
  });

  it("serves the main address as before", () => {
    expect(at("beardedboardgames.com", "/games/fences")).toMatchObject({ uri: "/index.html" });
    expect(at("beardedboardgames.com", "/home")).toMatchObject({ headers: { location: { value: "/" } } });
  });

  it("leaves every name alone until the domain is the main address", () => {
    expect(
      handler({ request: { uri: "/", headers: { host: { value: "bbg-live.prismcortex.net" } } } as Request }),
    ).toMatchObject({
      uri: "/index.html",
    });
  });
});
