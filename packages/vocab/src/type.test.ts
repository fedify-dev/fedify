import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert/assert-equals";
import { getTypeId } from "./type.ts";
import { Person } from "./vocab.ts";

test("getTypeId()", () => {
  const obj = new Person({});
  assertEquals(
    getTypeId(obj),
    new URL("https://www.w3.org/ns/activitystreams#Person"),
  );
  const obj2: Person | null = null;
  assertEquals(getTypeId(obj2), null);
  const obj3: Person | undefined = undefined;
  assertEquals(getTypeId(obj3), undefined);
  const obj4: Person | null | undefined = null;
  assertEquals(getTypeId(obj4), null);
  const obj5: Person | null | undefined = undefined;
  assertEquals(getTypeId(obj5), undefined);
});
