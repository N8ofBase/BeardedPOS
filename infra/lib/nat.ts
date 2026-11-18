// The live store's NAT instance: a t4g.nano that lets the Lambda (in private subnets) reach Square,
// SES and Secrets Manager. Our own setup commands, because CDK's defaults fail on this box:
// - `dnf install` runs out of memory on the nano's 0.5 GB and is killed (seen 2026-11-18), so a
//   swap file goes on first;
// - they find the network card with `route`, which Amazon Linux 2023 doesn't ship.

/** Amazon Linux 2023, standard image, ARM. (Changing the image replaces the instance, rerunning setup.) */
export const NAT_IMAGE_PARAMETER = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64";

export const NAT_COMMANDS = [
  "set -x",
  // 1 GB of swap, so dnf fits in memory.
  "fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024",
  "chmod 600 /swapfile",
  "mkswap /swapfile",
  "swapon /swapfile",
  'echo "/swapfile swap swap defaults 0 0" >> /etc/fstab',
  "dnf install -y --setopt=install_weak_deps=False iptables-services",
  "systemctl enable --now iptables",
  'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/90-nat.conf',
  "sysctl -p /etc/sysctl.d/90-nat.conf",
  // The network card that carries the default route, e.g. ens5.
  "OUT=$(ip -o route show default | awk '{print $5}' | head -n1)",
  'iptables -t nat -A POSTROUTING -o "$OUT" -j MASQUERADE',
  "iptables -F FORWARD",
  // Saved for reboots.
  "/usr/libexec/iptables/iptables.init save",
];
