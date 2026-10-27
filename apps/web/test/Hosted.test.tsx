// The hosted register: email-code sign-in and calls over HTTPS, against a fake /api/pos.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@bearded/core";
import { createHttpApi, posFetch, SignedOutError } from "../src/api/http.ts";
import { HostedApp } from "../src/HostedApp.tsx";
import { ToastProvider } from "../src/ui/Toast.tsx";
import { meFor } from "./render.tsx";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A small /api/pos: one staff email and code, and a session flag in place of the cookie. */
function fakeServer() {
  let signedIn = false;
  const calls: { path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^\/api\/pos\//, "");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ path, body });
    if (path === "code") return json(200, { sent: true, devCode: "123456" });
    if (path === "session") {
      if (body.code !== "123456")
        return json(401, { error: "That code didn’t match or has expired. Ask for a new one." });
      signedIn = true;
      return json(200, { signedIn: true });
    }
    if (path === "signout") {
      signedIn = false;
      return json(200, { signedIn: false });
    }
    if (!signedIn) return json(401, { error: "Sign in to use the register." });
    if (path === "call/me") return json(200, { output: meFor("owner") });
    return json(404, { error: "Not found.", code: "not_found", fields: {} });
  });
  return { fetch, calls };
}

let server: ReturnType<typeof fakeServer>;
beforeEach(() => {
  server = fakeServer();
  vi.stubGlobal("fetch", server.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHosted() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/settings"]}>
        <ToastProvider>
          <HostedApp />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function signIn(code = "123456") {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "n8gr8@prismcortex.net" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  expect(await screen.findByText(/Your code is 123456/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("hosted register", () => {
  it("signs in with an emailed code and shows the test banner, with no demo reset", async () => {
    renderHosted();
    await signIn();
    expect(await screen.findByText(/Test register/)).toBeTruthy();
    expect(screen.queryByText("Reset demo")).toBeNull();
    expect(screen.queryByText("Switch role")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
    expect(server.calls.find((c) => c.path === "session")?.body).toEqual({
      email: "n8gr8@prismcortex.net",
      code: "123456",
    });
  });

  it("shows the server's sentence for a wrong code", async () => {
    renderHosted();
    await signIn("000000");
    expect(await screen.findByText(/didn’t match or has expired/)).toBeTruthy();
  });

  it("signs out back to the sign-in screen", async () => {
    renderHosted();
    await signIn();
    fireEvent.click((await screen.findAllByRole("button", { name: "Sign out" }))[0]!);
    expect(await screen.findByRole("heading", { name: "Sign in to the register" })).toBeTruthy();
    expect(server.calls.some((c) => c.path === "signout")).toBe(true);
  });
});

describe("register over HTTPS", () => {
  it("sends the input and gets back the output, with timestamps as Dates and dates as strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, { output: { createdAt: "2026-10-27T15:04:05.000Z", birthday: "1990-04-02" } }),
      ),
    );
    const out = (await createHttpApi(vi.fn()).call("me")) as unknown as Record<string, unknown>;
    expect(out.createdAt).toEqual(new Date("2026-10-27T15:04:05.000Z"));
    expect(out.birthday).toBe("1990-04-02");
  });

  it("turns a refusal into the AppError screens show, fields included", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(400, { error: "Check the price.", code: "invalid", fields: { price: "Too low" } }),
      ),
    );
    const err = await posFetch("call/saveProduct", { input: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).fields).toEqual({ price: "Too low" });
  });

  it("tells the app when the session has ended", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(401, { error: "Sign in to use the register." })),
    );
    const onSignedOut = vi.fn();
    await expect(createHttpApi(onSignedOut).call("me")).rejects.toBeInstanceOf(SignedOutError);
    expect(onSignedOut).toHaveBeenCalledOnce();
  });
});
