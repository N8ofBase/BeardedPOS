import type { Role } from "./auth.ts";

/** Who is calling. Built by the transport: the role picker in demo mode, Cognito claims when hosted. */
export interface Ctx {
  businessId: string;
  staffId: string;
  role: Role;
}
