import {
  type Service,
  SERVICES as LOCALTUNNEL_SERVICES,
} from "@hongminhee/localtunnel";

/**
 * The Fedify-operated public tunneling service.
 */
export const FEDIFY_TUNNEL_SERVICE = {
  host: "fedify.com.es:2222",
  port: 80,
  urlPattern: /https:\/\/[a-z0-9]{16}\.fedify\.com\.es(?=[/\s]|$)/,
  extraOptions: [
    "-o",
    "PubkeyAuthentication=no",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
  ],
  knownHosts: {
    // Ed25519 SHA256:MS+vPYDnU2dceunPdykxErOjWoTKQG/Hcy0HFfQc6mg
    // Verified on July 14, 2026.
    "[fedify.com.es]:2222": [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOepK/E2PANumZNFCicc/zv4EkyraFwqV8qveMtDC5b+",
    ],
  },
} as const satisfies Service;

/**
 * Available tunneling services for exposing local servers to the public
 * internet.
 */
export const TUNNEL_SERVICE_REGISTRY = {
  ...LOCALTUNNEL_SERVICES,
  "fedify.com.es": FEDIFY_TUNNEL_SERVICE,
} as const;

/**
 * A valid tunneling service name.
 */
export type TunnelService = keyof typeof TUNNEL_SERVICE_REGISTRY;

/**
 * Available tunneling service names.
 */
export const TUNNEL_SERVICE_NAMES = Object.freeze(
  Object.keys(TUNNEL_SERVICE_REGISTRY) as [
    TunnelService,
    ...TunnelService[],
  ],
);
