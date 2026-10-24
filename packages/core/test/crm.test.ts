import { describe, expect, it } from "vitest";
import {
  audienceDecision,
  cleanAudience,
  cleanTagName,
  describeAudience,
  EVERYONE,
  personalize,
  renderCampaignEmail,
  unsubscribeUrl,
  validateCampaign,
  type AudienceCandidate,
} from "../src/crm.ts";

const pat: AudienceCandidate = {
  kind: "person",
  email: "Pat@Example.com",
  emailOptIn: true,
  tagIds: ["vip", "backer"],
};
const shop: AudienceCandidate = {
  kind: "retailer",
  email: "buyer@shop.com",
  emailOptIn: true,
  tagIds: ["vip"],
};
const none = new Set<string>();

describe("who gets a bulk email", () => {
  it("matches by customer type", () => {
    expect(audienceDecision(pat, EVERYONE, none)).toBe("send");
    expect(audienceDecision(shop, { ...EVERYONE, kinds: ["person"] }, none)).toBe("no_match");
    expect(audienceDecision(shop, { ...EVERYONE, kinds: ["retailer"] }, none)).toBe("send");
  });

  it("matches any of, all of and none of the tags", () => {
    expect(audienceDecision(pat, { ...EVERYONE, anyTags: ["backer", "event"] }, none)).toBe("send");
    expect(audienceDecision(shop, { ...EVERYONE, anyTags: ["backer", "event"] }, none)).toBe("no_match");
    expect(audienceDecision(pat, { ...EVERYONE, allTags: ["vip", "backer"] }, none)).toBe("send");
    expect(audienceDecision(shop, { ...EVERYONE, allTags: ["vip", "backer"] }, none)).toBe("no_match");
    expect(audienceDecision(pat, { ...EVERYONE, anyTags: ["vip"], notTags: ["backer"] }, none)).toBe(
      "no_match",
    );
    expect(audienceDecision(shop, { ...EVERYONE, anyTags: ["vip"], notTags: ["backer"] }, none)).toBe("send");
  });

  it("never sends without an email, an opt-in, or to a suppressed address", () => {
    expect(audienceDecision({ ...pat, email: null }, EVERYONE, none)).toBe("no_email");
    expect(audienceDecision({ ...pat, emailOptIn: false }, EVERYONE, none)).toBe("not_opted_in");
    expect(audienceDecision(pat, EVERYONE, new Set(["pat@example.com"]))).toBe("suppressed");
  });

  it("refuses a tag that is both wanted and left out, and drops duplicates", () => {
    expect(() => cleanAudience({ ...EVERYONE, anyTags: ["a"], notTags: ["a"] })).toThrow(/both included/);
    expect(
      cleanAudience({ kinds: ["person", "person"], anyTags: ["a", "a"], allTags: [], notTags: [] }),
    ).toEqual({
      kinds: ["person"],
      anyTags: ["a"],
      allTags: [],
      notTags: [],
    });
    expect(() => cleanAudience({ ...EVERYONE, kinds: ["robot" as "person"] })).toThrow();
  });

  it("describes the audience in plain words", () => {
    const name = (id: string) => ({ vip: "VIP", backer: "Backer", shop: "Retailer" })[id] ?? id;
    expect(describeAudience(EVERYONE, name)).toBe("Everyone who agreed to email");
    expect(describeAudience({ ...EVERYONE, kinds: ["retailer"] }, name)).toBe(
      "Retailers who agreed to email",
    );
    expect(
      describeAudience(
        { kinds: ["person"], anyTags: ["vip", "backer"], allTags: [], notTags: ["shop"] },
        name,
      ),
    ).toBe("People tagged VIP or Backer, not tagged Retailer who agreed to email");
  });
});

describe("tags", () => {
  it("trims and limits tag names", () => {
    expect(cleanTagName("  Kickstarter   backer ")).toBe("Kickstarter backer");
    expect(cleanTagName("   ")).toBeNull();
    expect(cleanTagName("x".repeat(41))).toBeNull();
  });
});

describe("the email", () => {
  const sender = {
    fromName: "Bearded Board Games",
    fromAddress: "news@mail.example.com",
    mailingAddress: "1 Main St, St. Louis, MO",
  };
  const url = unsubscribeUrl("https://shop.example.com/", "biz-1", "abc");

  it("builds the unsubscribe link", () => {
    expect(url).toBe("https://shop.example.com/unsubscribe?b=biz-1&t=abc");
  });

  it("has one-click unsubscribe headers, the link and the mailing address", () => {
    const e = renderCampaignEmail({
      sender,
      to: "pat@example.com",
      name: "Pat Lee",
      subject: " New game! ",
      body: "Hi {first name},\n\nFences is back.",
      unsubscribeUrl: url,
    });
    expect(e.from).toBe('"Bearded Board Games" <news@mail.example.com>');
    expect(e.subject).toBe("New game!");
    expect(e.headers).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(e.text).toContain("Hi Pat,");
    expect(e.text).toContain(`Unsubscribe: ${url}`);
    expect(e.text).toContain("1 Main St, St. Louis, MO");
    expect(e.html).toContain(`<a href="${url.replace(/&/g, "&amp;")}">Unsubscribe</a>`);
    expect(e.html).toContain("1 Main St, St. Louis, MO");
  });

  it("escapes HTML in the body and links web addresses", () => {
    const e = renderCampaignEmail({
      sender,
      to: "a@b.co",
      name: "",
      subject: "x",
      body: "<script>hi</script> https://beardedboardgames.com",
      unsubscribeUrl: url,
    });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain('<a href="https://beardedboardgames.com">https://beardedboardgames.com</a>');
  });

  it("says 'there' when there's no first name", () => {
    expect(personalize("Hi {First Name}!", "  ")).toBe("Hi there!");
  });

  it("needs a subject and a body", () => {
    expect(validateCampaign({ subject: " ", body: "" })).toEqual({
      subject: "Add a subject.",
      body: "Write the email.",
    });
    expect(validateCampaign({ subject: "Hi", body: "Hello" })).toEqual({});
  });
});
