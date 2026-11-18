import { describe, expect, it } from "vitest";
import { NAT_COMMANDS, NAT_IMAGE_PARAMETER } from "../lib/nat.ts";

describe("the live store's NAT instance setup", () => {
  it("finds the network card with ip, which Amazon Linux 2023 has (route isn't there)", () => {
    const script = NAT_COMMANDS.join("\n");
    expect(script).not.toMatch(/(^|\$\(|\| )route\b/m);
    expect(script).toContain("ip -o route show default");
    expect(script).toMatch(/MASQUERADE/);
    expect(script).toMatch(/ip_forward=1/);
  });

  it("uses the ARM image, to match the t4g instance", () => {
    expect(NAT_IMAGE_PARAMETER).toMatch(/al2023-.*arm64$/);
  });
});
