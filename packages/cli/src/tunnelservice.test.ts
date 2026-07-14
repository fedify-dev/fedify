import { SERVICES } from "@hongminhee/localtunnel";
import { deepEqual, doesNotMatch, equal, match } from "node:assert/strict";
import test from "node:test";
import {
  FEDIFY_TUNNEL_SERVICE,
  TUNNEL_SERVICE_NAMES,
  TUNNEL_SERVICE_REGISTRY,
} from "./tunnelservice.ts";

test("Fedify tunnel service uses the public HTTP endpoint", () => {
  equal(FEDIFY_TUNNEL_SERVICE.host, "fedify.com.es:2222");
  equal(FEDIFY_TUNNEL_SERVICE.port, 80);
  deepEqual(FEDIFY_TUNNEL_SERVICE.extraOptions, [
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
  ]);
  deepEqual(FEDIFY_TUNNEL_SERVICE.knownHosts, {
    "[fedify.com.es]:2222": [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOepK/E2PANumZNFCicc/zv4EkyraFwqV8qveMtDC5b+",
    ],
  });
});

test("Fedify tunnel service accepts only allocated public URL hosts", () => {
  match(
    "https://0123456789abcdef.fedify.com.es",
    FEDIFY_TUNNEL_SERVICE.urlPattern,
  );
  match(
    "https://0123456789abcdef.fedify.com.es/",
    FEDIFY_TUNNEL_SERVICE.urlPattern,
  );
  doesNotMatch(
    "https://short.fedify.com.es",
    FEDIFY_TUNNEL_SERVICE.urlPattern,
  );
  doesNotMatch(
    "https://0123456789abcdef.fedify.com.es.example.com",
    FEDIFY_TUNNEL_SERVICE.urlPattern,
  );
});

test("Fedify CLI tunnel registry extends localtunnel services", () => {
  equal(
    TUNNEL_SERVICE_REGISTRY["serveo.net"],
    SERVICES["serveo.net"],
  );
  equal(
    TUNNEL_SERVICE_REGISTRY["pinggy.io"],
    SERVICES["pinggy.io"],
  );
  equal(
    TUNNEL_SERVICE_REGISTRY["fedify.com.es"],
    FEDIFY_TUNNEL_SERVICE,
  );
  deepEqual(TUNNEL_SERVICE_NAMES, [
    "serveo.net",
    "pinggy.io",
    "fedify.com.es",
  ]);
});
