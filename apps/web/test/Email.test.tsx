import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmailRoutes } from "../src/pages/email/EmailPage.tsx";
import { renderAs } from "./render.tsx";

afterEach(cleanup);

const tags = [
  { id: "t1", name: "VIP", customers: 40 },
  { id: "t2", name: "Retailer list", customers: 6 },
];

describe("Email composer", () => {
  it("counts who gets it as tags are picked, and says who's left out", async () => {
    const { call } = renderAs(
      "manager",
      <EmailRoutes />,
      {
        listTags: tags,
        previewAudience: (i: { audience: { anyTags: string[] } }) => ({
          count: i.audience.anyTags.length ? 38 : 120,
          noEmail: 3,
          notOptedIn: 9,
          suppressed: 1,
          sample: ["Pat Lee"],
          description: i.audience.anyTags.length
            ? "Everyone tagged VIP who agreed to email"
            : "Everyone who agreed to email",
        }),
      },
      "/new",
    );
    expect(await screen.findByRole("button", { name: "Send to 120" })).toBeTruthy();
    expect(
      screen.getByText(/9 haven't agreed to email, 3 have no email address, 1 unsubscribed or bounced/),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("VIP")[0]!);
    expect(await screen.findByRole("button", { name: "Send to 38" })).toBeTruthy();
    expect(call).toHaveBeenCalledWith("previewAudience", {
      audience: { kinds: [], anyTags: ["t1"], allTags: [], notTags: [] },
    });
    // A tag picked to include can't also be left out.
    expect((screen.getAllByLabelText("VIP")[2] as HTMLInputElement).disabled).toBe(true);
  });

  it("needs a subject before sending", async () => {
    const { call } = renderAs(
      "owner",
      <EmailRoutes />,
      {
        listTags: tags,
        previewAudience: {
          count: 2,
          noEmail: 0,
          notOptedIn: 0,
          suppressed: 0,
          sample: [],
          description: "Everyone",
        },
      },
      "/new",
    );
    const send = await screen.findByRole("button", { name: "Send to 2" });
    fireEvent.click(send);
    fireEvent.click(screen.getByRole("button", { name: "Tap again to send to 2" }));
    expect(screen.getByText("Add a subject.")).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith("sendCampaign", expect.anything());
  });
});
