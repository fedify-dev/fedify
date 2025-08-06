import { assertEquals } from "@std/assert";
import {
  hasSingularAccessor,
  isNonFunctionalProperty,
  type PropertySchema,
  type TypeUri,
} from "./schema.ts";

Deno.test("isNonFunctionalProperty", async (t) => {
  await t.step("returns true for non-functional property", () => {
    const property: PropertySchema = {
      singularName: "name",
      pluralName: "names",
      uri: "https://example.com/name",
      description: "A name property",
      range: ["https://example.com/Text"] as [TypeUri],
      functional: false,
    };

    assertEquals(isNonFunctionalProperty(property), true);

    // Type narrowing test - this should compile without errors
    if (isNonFunctionalProperty(property)) {
      // These properties should be accessible
      const _pluralName = property.pluralName;
      const _singularAccessor = property.singularAccessor;
      const _container = property.container;
    }
  });

  await t.step("returns true for property without functional field", () => {
    const property: PropertySchema = {
      singularName: "name",
      pluralName: "names",
      uri: "https://example.com/name",
      description: "A name property",
      range: ["https://example.com/Text"] as [TypeUri],
      // functional is optional and defaults to false
    };

    assertEquals(isNonFunctionalProperty(property), true);
  });

  await t.step("returns false for functional property", () => {
    const property: PropertySchema = {
      singularName: "id",
      uri: "https://example.com/id",
      description: "An ID property",
      range: ["https://example.com/ID"] as [TypeUri],
      functional: true,
    };

    assertEquals(isNonFunctionalProperty(property), false);
  });
});

Deno.test("hasSingularAccessor", async (t) => {
  await t.step("returns true for functional property", () => {
    const property: PropertySchema = {
      singularName: "id",
      uri: "https://example.com/id",
      description: "An ID property",
      range: ["https://example.com/ID"] as [TypeUri],
      functional: true,
    };

    assertEquals(hasSingularAccessor(property), true);
  });

  await t.step(
    "returns true for non-functional property with singularAccessor",
    () => {
      const property: PropertySchema = {
        singularName: "name",
        pluralName: "names",
        uri: "https://example.com/name",
        description: "A name property",
        range: ["https://example.com/Text"] as [TypeUri],
        functional: false,
        singularAccessor: true,
      };

      assertEquals(hasSingularAccessor(property), true);
    },
  );

  await t.step(
    "returns false for non-functional property without singularAccessor",
    () => {
      const property: PropertySchema = {
        singularName: "name",
        pluralName: "names",
        uri: "https://example.com/name",
        description: "A name property",
        range: ["https://example.com/Text"] as [TypeUri],
        functional: false,
        singularAccessor: false,
      };

      assertEquals(hasSingularAccessor(property), false);
    },
  );

  await t.step(
    "returns false for non-functional property with undefined singularAccessor",
    () => {
      const property: PropertySchema = {
        singularName: "name",
        pluralName: "names",
        uri: "https://example.com/name",
        description: "A name property",
        range: ["https://example.com/Text"] as [TypeUri],
        // functional defaults to false, singularAccessor is undefined
      };

      assertEquals(hasSingularAccessor(property), false);
    },
  );
});

Deno.test("Type guard combinations", async (t) => {
  await t.step("functional property with redundantProperties", () => {
    const property: PropertySchema = {
      singularName: "type",
      uri: "https://www.w3.org/ns/activitystreams#type",
      description: "The type of the object",
      range: ["https://example.com/Type"] as [TypeUri],
      functional: true,
      redundantProperties: [
        { uri: "https://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
      ],
    };

    assertEquals(isNonFunctionalProperty(property), false);
    assertEquals(hasSingularAccessor(property), true);
  });

  await t.step("non-functional property with container", () => {
    const property: PropertySchema = {
      singularName: "item",
      pluralName: "items",
      uri: "https://example.com/item",
      description: "List of items",
      range: ["https://example.com/Item"] as [TypeUri],
      functional: false,
      container: "list",
    };

    assertEquals(isNonFunctionalProperty(property), true);
    assertEquals(hasSingularAccessor(property), false);

    // Type narrowing test
    if (isNonFunctionalProperty(property)) {
      assertEquals(property.container, "list");
    }
  });

  await t.step("non-functional property with graph container", () => {
    const property: PropertySchema = {
      singularName: "member",
      pluralName: "members",
      uri: "https://example.com/member",
      description: "Graph of members",
      range: ["https://example.com/Member"] as [TypeUri],
      functional: false,
      container: "graph",
    };

    assertEquals(isNonFunctionalProperty(property), true);
    assertEquals(hasSingularAccessor(property), false);

    // Type narrowing test
    if (isNonFunctionalProperty(property)) {
      assertEquals(property.container, "graph");
    }
  });

  await t.step("untyped property", () => {
    const property: PropertySchema = {
      singularName: "value",
      pluralName: "values",
      uri: "https://example.com/value",
      description: "Untyped values",
      untyped: true,
      range: ["https://example.com/Value"] as [TypeUri],
    };

    assertEquals(isNonFunctionalProperty(property), true);
    assertEquals(hasSingularAccessor(property), false);
  });
});
