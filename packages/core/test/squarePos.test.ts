import { describe, expect, it } from "vitest";
import {
  readSquarePosAnswer,
  squarePosPlatform,
  squarePosUrl,
  squareReturnUrl,
  type SquarePosRequest,
} from "../src/squarePos.ts";

const req: SquarePosRequest = {
  applicationId: "sq0idp-abc",
  callbackUrl: "https://bbg-live.prismcortex.net/register/square-return",
  state: "pos_123",
  amountCents: 2675,
  currency: "USD",
  note: "Receipt #1042",
};

describe("squarePosPlatform", () => {
  it("knows iPhones, iPads (which say Mac with a touch screen) and Android", () => {
    expect(squarePosPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(squarePosPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(squarePosPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("other");
    expect(squarePosPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("android");
    expect(squarePosPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("other");
  });
});

describe("squarePosUrl", () => {
  it("builds the iOS link with the amount in cents, our reference and the return page", () => {
    const url = squarePosUrl("ios", req)!;
    expect(url.startsWith("square-commerce-v1://payment/create?data=")).toBe(true);
    const data = JSON.parse(decodeURIComponent(url.split("data=")[1]!)) as Record<string, unknown>;
    expect(data).toEqual({
      amount_money: { amount: 2675, currency_code: "USD" },
      callback_url: req.callbackUrl,
      client_id: "sq0idp-abc",
      version: "1.3",
      notes: "Receipt #1042",
      state: "pos_123",
      options: { supported_tender_types: ["CREDIT_CARD"], auto_return: true, skip_receipt: true },
    });
  });

  it("builds the Android intent with every value encoded", () => {
    const url = squarePosUrl("android", req)!;
    expect(url.startsWith("intent:#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;")).toBe(
      true,
    );
    expect(url.endsWith(";end")).toBe(true);
    expect(url).toContain("i.com.squareup.pos.TOTAL_AMOUNT=2675;");
    expect(url).toContain(`S.com.squareup.pos.WEB_CALLBACK_URI=${encodeURIComponent(req.callbackUrl)};`);
    expect(url).toContain("S.com.squareup.pos.REQUEST_METADATA=pos_123;");
    expect(url).toContain("S.com.squareup.pos.NOTE=Receipt%20%231042;");
    expect(url).toContain("S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD;");
  });

  it("has no link for a laptop", () => {
    expect(squarePosUrl("other", req)).toBeNull();
  });
});

describe("squareReturnUrl", () => {
  it("is the register's return page under the site", () => {
    expect(squareReturnUrl("https://beardedboardgames.com/")).toBe(
      "https://beardedboardgames.com/register/square-return",
    );
  });
});

describe("readSquarePosAnswer", () => {
  const ios = (d: object) => `?data=${encodeURIComponent(JSON.stringify(d))}`;

  it("reads iOS answers: paid, or an error code", () => {
    expect(
      readSquarePosAnswer(
        ios({ status: "ok", transaction_id: "T1", client_transaction_id: "C1", state: "pos_1" }),
      ),
    ).toEqual({
      state: "pos_1",
      transactionId: "T1",
    });
    expect(
      readSquarePosAnswer(ios({ status: "error", error_code: "payment_canceled", state: "pos_1" })),
    ).toEqual({
      state: "pos_1",
      errorCode: "payment_canceled",
    });
  });

  it("reads Android answers", () => {
    expect(
      readSquarePosAnswer(
        "?com.squareup.pos.CLIENT_TRANSACTION_ID=C1&com.squareup.pos.SERVER_TRANSACTION_ID=T1&com.squareup.pos.REQUEST_METADATA=pos_2",
      ),
    ).toEqual({ state: "pos_2", transactionId: "T1" });
    expect(
      readSquarePosAnswer(
        "?com.squareup.pos.ERROR_CODE=com.squareup.pos.ERROR_TRANSACTION_CANCELED&com.squareup.pos.ERROR_DESCRIPTION=Canceled+by+seller&com.squareup.pos.REQUEST_METADATA=pos_2",
      ),
    ).toEqual({
      state: "pos_2",
      errorCode: "com.squareup.pos.ERROR_TRANSACTION_CANCELED",
      errorDescription: "Canceled by seller",
    });
    // Paid offline: no server transaction id, so the register looks it up in Square instead.
    expect(
      readSquarePosAnswer(
        "?com.squareup.pos.CLIENT_TRANSACTION_ID=C1&com.squareup.pos.REQUEST_METADATA=pos_3",
      ),
    ).toEqual({
      state: "pos_3",
    });
  });

  it("is null for anything that isn't Square's answer", () => {
    expect(readSquarePosAnswer("")).toBeNull();
    expect(readSquarePosAnswer("?data=not-json")).toBeNull();
    expect(readSquarePosAnswer(`?data=${encodeURIComponent("[1]")}`)).toBeNull();
    expect(readSquarePosAnswer("?data=%E0%A4%A")).toBeNull();
  });
});
