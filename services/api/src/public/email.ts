// The unsubscribe link in every bulk email. No sign-in: the random token in the link
// is the key, and it can only turn email off.
import { definePublic } from "./handler.ts";
import { unsubscribe as turnOff, unsubscribeInfo, type UnsubscribeInfo } from "../handlers/email.ts";

export const unsubscribeStatus = definePublic<{ token: string }, UnsubscribeInfo>({
  signedIn: false,
  run: (trx, ctx, { token }) => unsubscribeInfo(trx, ctx.businessId, token),
});

export const unsubscribe = definePublic<{ token: string }, UnsubscribeInfo>({
  signedIn: false,
  run: (trx, ctx, { token }) => turnOff(trx, ctx.businessId, token),
});
