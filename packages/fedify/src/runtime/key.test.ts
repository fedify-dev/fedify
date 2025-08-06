import { assertEquals } from "@std/assert";
import { exportJwk, importJwk } from "../sig/key.ts";
import { test } from "../testing/mod.ts";
import {
  exportMultibaseKey,
  exportSpki,
  importMultibaseKey,
  importPem,
  importPkcs1,
  importSpki,
} from "./key.ts";

// cSpell: disable
const rsaSpki = "-----BEGIN PUBLIC KEY-----\n" +
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxsRuvCkgJtflBTl4OVsm\n" +
  "nt/J1mQfZasfJtN33dcZ3d1lJroxmgmMu69zjGEAwkNbMQaWNLqC4eogkJaeJ4RR\n" +
  "5MHYXkL9nNilVoTkjX5BVit3puzs7XJ7WQnKQgQMI+ezn24GHsZ/v1JIo77lerX5\n" +
  "k4HNwTNVt+yaZVQWaOMR3+6FwziQR6kd0VuG9/a9dgAnz2cEoORRC1i4W7IZaB1s\n" +
  "Znh1WbHbevlGd72HSXll5rocPIHn8gq6xpBgpHwRphlRsgn4KHaJ6brXDIJjrnQh\n" +
  "Ie/YUBOGj/ImSEXhRwlFerKsoAVnZ0Hwbfa46qk44TAt8CyoPMWmpK6pt0ng4pQ2\n" +
  "uwIDAQAB\n" +
  "-----END PUBLIC KEY-----\n";
// cSpell: enable

// cSpell: disable
const rsaPkcs1 = "-----BEGIN RSA PUBLIC KEY-----\n" +
  "MIIBCgKCAQEAxsRuvCkgJtflBTl4OVsmnt/J1mQfZasfJtN33dcZ3d1lJroxmgmM\n" +
  "u69zjGEAwkNbMQaWNLqC4eogkJaeJ4RR5MHYXkL9nNilVoTkjX5BVit3puzs7XJ7\n" +
  "WQnKQgQMI+ezn24GHsZ/v1JIo77lerX5k4HNwTNVt+yaZVQWaOMR3+6FwziQR6kd\n" +
  "0VuG9/a9dgAnz2cEoORRC1i4W7IZaB1sZnh1WbHbevlGd72HSXll5rocPIHn8gq6\n" +
  "xpBgpHwRphlRsgn4KHaJ6brXDIJjrnQhIe/YUBOGj/ImSEXhRwlFerKsoAVnZ0Hw\n" +
  "bfa46qk44TAt8CyoPMWmpK6pt0ng4pQ2uwIDAQAB\n" +
  "-----END RSA PUBLIC KEY-----\n";
// cSpell: enable

const rsaJwk: JsonWebKey = {
  alg: "RS256",
  // cSpell: disable
  e: "AQAB",
  // cSpell: enable
  ext: true,
  key_ops: ["verify"],
  kty: "RSA",
  // cSpell: disable
  n: "xsRuvCkgJtflBTl4OVsmnt_J1mQfZasfJtN33dcZ3d1lJroxmgmMu69zjGEAwkNbMQaWN" +
    "LqC4eogkJaeJ4RR5MHYXkL9nNilVoTkjX5BVit3puzs7XJ7WQnKQgQMI-ezn24GHsZ_v1J" +
    "Io77lerX5k4HNwTNVt-yaZVQWaOMR3-6FwziQR6kd0VuG9_a9dgAnz2cEoORRC1i4W7IZa" +
    "B1sZnh1WbHbevlGd72HSXll5rocPIHn8gq6xpBgpHwRphlRsgn4KHaJ6brXDIJjrnQhIe_" +
    "YUBOGj_ImSEXhRwlFerKsoAVnZ0Hwbfa46qk44TAt8CyoPMWmpK6pt0ng4pQ2uw",
  // cSpell: enable
};

const rsaMultibase =
  // cSpell: disable
  "z4MXj1wBzi9jUstyPqYMn6Gum79JtbKFiHTibtPRoPeufjdimA24Kg8Q5N7E2eMpgVUtD61kUv" +
  "my4FaT5D5G8XU3ktxeduwEw5FHTtiLCzaruadf6rit1AUPL34UtcPuHh6GxBzTxgFKMMuzcHiU" +
  "zG9wvbxn7toS4H2gbmUn1r91836ET2EVgmSdzju614Wu67ukyBGivcboncdfxPSR5JXwURBaL8" +
  "K2P6yhKn3NyprFV8s6QpN4zgQMAD3Q6fjAsEvGNwXaQTZmEN2yd1NQ7uBE3RJ2XywZnehmfLQT" +
  "EqD7Ad5XM3qfLLd9CtdzJGBkRfunHhkH1kz8dHL7hXwtk5EMXktY4QF5gZ1uisUV5mpPjEgqz7uDz";
// cSpell: enable

// cSpell: disable
const ed25519Pem = "-----BEGIN PUBLIC KEY-----\n" +
  "MCowBQYDK2VwAyEAvrabdlLgVI5jWl7GpF+fLFJVF4ccI8D7h+v5ulBCYwo=\n" +
  "-----END PUBLIC KEY-----\n";
// cSpell: enable

const ed25519Jwk: JsonWebKey = {
  alg: "Ed25519",
  kty: "OKP",
  crv: "Ed25519",
  // cSpell: disable
  x: "vrabdlLgVI5jWl7GpF-fLFJVF4ccI8D7h-v5ulBCYwo",
  // cSpell: enable
  key_ops: ["verify"],
  ext: true,
};

// cSpell: disable
const ed25519Multibase = "z6MksHj1MJnidCtDiyYW9ugNFftoX9fLK4bornTxmMZ6X7vq";
// cSpell: enable

test("importSpki()", async () => {
  const rsaKey = await importSpki(rsaSpki);
  assertEquals(await exportJwk(rsaKey), rsaJwk);

  const ed25519Key = await importSpki(ed25519Pem);
  assertEquals(await exportJwk(ed25519Key), ed25519Jwk);
});

test("exportSpki()", async () => {
  const rsaKey = await importJwk(rsaJwk, "public");
  const rsaSpki = await exportSpki(rsaKey);
  assertEquals(rsaSpki, rsaSpki);

  const ed25519Key = await importJwk(ed25519Jwk, "public");
  const ed25519Spki = await exportSpki(ed25519Key);
  assertEquals(ed25519Spki, ed25519Pem);
});

test("importPkcs1()", async () => {
  const rsaKey = await importPkcs1(rsaPkcs1);
  assertEquals(await exportJwk(rsaKey), rsaJwk);
});

test("importPem()", async () => {
  const rsaPkcs1Key = await importPem(rsaPkcs1);
  assertEquals(await exportJwk(rsaPkcs1Key), rsaJwk);

  const rsaSpkiKey = await importPem(rsaSpki);
  assertEquals(await exportJwk(rsaSpkiKey), rsaJwk);

  const ed25519Key = await importPem(ed25519Pem);
  assertEquals(await exportJwk(ed25519Key), ed25519Jwk);
});

test("importMultibase()", async () => {
  const rsaKey = await importMultibaseKey(rsaMultibase);
  assertEquals(await exportJwk(rsaKey), rsaJwk);

  const ed25519Key = await importMultibaseKey(ed25519Multibase);
  assertEquals(await exportJwk(ed25519Key), ed25519Jwk);
});

test("exportMultibaseKey()", async () => {
  const rsaKey = await importJwk(rsaJwk, "public");
  const rsaMb = await exportMultibaseKey(rsaKey);
  assertEquals(rsaMb, rsaMultibase);

  const ed25519Key = await importJwk(ed25519Jwk, "public");
  const ed25519Mb = await exportMultibaseKey(ed25519Key);
  assertEquals(ed25519Mb, ed25519Multibase);

  // Test vectors from <https://codeberg.org/fediverse/fep/src/branch/main/fep/521a/fep-521a.feature>:
  const rsaKey2 = await importJwk({
    alg: "RS256",
    ext: true,
    key_ops: ["verify"],
    // cSpell: disable
    e: "AQAB",
    kty: "RSA",
    n: "sbX82NTV6IylxCh7MfV4hlyvaniCajuP97GyOqSvTmoEdBOflFvZ06kR_9D6ctt45Fk6h" +
      "skfnag2GG69NALVH2o4RCR6tQiLRpKcMRtDYE_thEmfBvDzm_VVkOIYfxu-Ipuo9J_S5XD" +
      "NDjczx2v-3oDh5-CIHkU46hvFeCvpUS-L8TJSbgX0kjVk_m4eIb9wh63rtmD6Uz_KBtCo5" +
      "mmR4TEtcLZKYdqMp3wCjN-TlgHiz_4oVXWbHUefCEe8rFnX1iQnpDHU49_SaXQoud1jCae" +
      "xFn25n-Aa8f8bc5Vm-5SeRwidHa6ErvEhTvf1dz6GoNPp2iRvm-wJ1gxwWJEYPQ",
    // cSpell: enable
  }, "public");
  const rsaMb2 = await exportMultibaseKey(rsaKey2);
  assertEquals(
    rsaMb2,
    // cSpell: disable
    "z4MXj1wBzi9jUstyPMS4jQqB6KdJaiatPkAtVtGc6bQEQEEsKTic4G7Rou3iBf9vPmT5dbkm" +
      "9qsZsuVNjq8HCuW1w24nhBFGkRE4cd2Uf2tfrB3N7h4mnyPp1BF3ZttHTYv3DLUPi1zMdk" +
      "ULiow3M1GfXkoC6DoxDUm1jmN6GBj22SjVsr6dxezRVQc7aj9TxE7JLbMH1wh5X3kA58H3" +
      "DFW8rnYMakFGbca5CB2Jf6CnGQZmL7o5uJAdTwXfy2iiiyPxXEGerMhHwhjTA1mKYobyk2" +
      "CpeEcmvynADfNZ5MBvcCS7m3XkFCMNUYBS9NQ3fze6vMSUPsNa6GVYmKx2x6JrdEjCk3qR" +
      "MMmyjnjCMfR4pXbRMZa3i",
    // cSpell: enable
  );

  const ed25519Key2 = await importJwk({
    alg: "Ed25519",
    crv: "Ed25519",
    ext: true,
    key_ops: ["verify"],
    kty: "OKP",
    // cSpell: disable
    x: "Lm_M42cB3HkUiODQsXRcweM6TByfzEHGO9ND274JcOY",
    // cSpell: enable
  }, "public");
  const ed25519Mb2 = await exportMultibaseKey(ed25519Key2);
  assertEquals(
    ed25519Mb2,
    // cSpell: disable
    "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    // cSpell: enable
  );
});
