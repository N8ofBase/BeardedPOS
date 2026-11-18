// The live store's NAT instance: a t4g.nano that lets the Lambda (in private subnets) reach Square,
// SES and Secrets Manager. Our own setup commands, because CDK's defaults call `route`, which Amazon
// Linux 2023 doesn't ship, and then forward nothing.

/** Amazon Linux 2023, minimal, ARM. */
export const NAT_IMAGE_PARAMETER =
  "/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-default-arm64";

export const NAT_COMMANDS = [
  "dnf install -y iptables-services",
  "systemctl enable --now iptables",
  'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/90-nat.conf',
  "sysctl -p /etc/sysctl.d/90-nat.conf",
  // The network card that carries the default route, e.g. ens5.
  "OUT=$(ip -o route show default | awk '{print $5}' | head -n1)",
  'iptables -t nat -A POSTROUTING -o "$OUT" -j MASQUERADE',
  "iptables -F FORWARD",
  // Saved for reboots (the minimal image has no `service` wrapper).
  "/usr/libexec/iptables/iptables.init save",
];
