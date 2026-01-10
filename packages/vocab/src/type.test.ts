import { test } from "@fedify/fixture";
import { deepStrictEqual } from "node:assert/strict";
import { getTypeId } from "./type.ts";
import { Person } from "./vocab.ts";

test("getTypeId()", () => {
  const obj = new Person({});
  deepStrictEqual(
    getTypeId(obj),
    new URL("https://www.w3.org/ns/activitystreams#Person"),
  );
  const obj2: Person | null = null;
  deepStrictEqual(getTypeId(obj2), null);
  const obj3: Person | undefined = undefined;
  deepStrictEqual(getTypeId(obj3), undefined);
  const obj4: Person | null | undefined = null;
  deepStrictEqual(getTypeId(obj4), null);
  const obj5: Person | null | undefined = undefined;
  deepStrictEqual(getTypeId(obj5), undefined);
});
