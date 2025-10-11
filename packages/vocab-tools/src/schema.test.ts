import { deepStrictEqual, ok } from "node:assert";
import { test } from "node:test";
import {
  hasSingularAccessor,
  isNonFunctionalProperty,
  type PropertySchema,
  type TypeUri,
} from "./schema.ts";

test(
  "isNonFunctionalProperty: " +
    "returns true for non-functional property",
  () => {
    const property: PropertySchema = {
      singularName: "name",
      pluralName: "names",
      uri: "https://example.com/name",
      description: "A name property",
      range: ["https://example.com/Text"] as [TypeUri],
      functional: false,
    };

    ok(isNonFunctionalProperty(property));

    // Type narrowing test - this should compile without errors
    if (isNonFunctionalProperty(property)) {
      // These properties should be accessible
      const _pluralName = property.pluralName;
      const _singularAccessor = property.singularAccessor;
      const _container = property.container;
    }
  },
);

test(
  "isNonFunctionalProperty: " +
    "returns true for property without functional field",
  () => {
    const property: PropertySchema = {
      singularName: "name",
      pluralName: "names",
      uri: "https://example.com/name",
      description: "A name property",
      range: ["https://example.com/Text"] as [TypeUri],
      // functional is optional and defaults to false
    };

    ok(isNonFunctionalProperty(property));
  },
);

test("isNonFunctionalProperty: returns false for functional property", () => {
  const property: PropertySchema = {
    singularName: "id",
    uri: "https://example.com/id",
    description: "An ID property",
    range: ["https://example.com/ID"] as [TypeUri],
    functional: true,
  };

  ok(!isNonFunctionalProperty(property));
});

test("hasSingularAccessor: returns true for functional property", () => {
  const property: PropertySchema = {
    singularName: "id",
    uri: "https://example.com/id",
    description: "An ID property",
    range: ["https://example.com/ID"] as [TypeUri],
    functional: true,
  };

  ok(hasSingularAccessor(property));
});

test(
  "hasSingularAccessor: " +
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

    ok(hasSingularAccessor(property));
  },
);

test(
  "hasSingularAccessor: " +
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

    ok(!hasSingularAccessor(property));
  },
);

test(
  "hasSingularAccessor: " +
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

    ok(!hasSingularAccessor(property));
  },
);

test(
  "Type guard combinations: " + "functional property with redundantProperties",
  () => {
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

    ok(!isNonFunctionalProperty(property));
    ok(hasSingularAccessor(property));
  },
);

test("Type guard combinations: non-functional property with container", () => {
  const property: PropertySchema = {
    singularName: "item",
    pluralName: "items",
    uri: "https://example.com/item",
    description: "List of items",
    range: ["https://example.com/Item"] as [TypeUri],
    functional: false,
    container: "list",
  };

  ok(isNonFunctionalProperty(property));
  ok(!hasSingularAccessor(property));

  // Type narrowing test
  if (isNonFunctionalProperty(property)) {
    deepStrictEqual(property.container, "list");
  }
});

test(
  "Type guard combinations: non-functional property with graph container",
  () => {
    const property: PropertySchema = {
      singularName: "member",
      pluralName: "members",
      uri: "https://example.com/member",
      description: "Graph of members",
      range: ["https://example.com/Member"] as [TypeUri],
      functional: false,
      container: "graph",
    };

    ok(isNonFunctionalProperty(property));
    ok(!hasSingularAccessor(property));

    // Type narrowing test
    if (isNonFunctionalProperty(property)) {
      deepStrictEqual(property.container, "graph");
    }
  },
);

test("Type guard combinations: untyped property", () => {
  const property: PropertySchema = {
    singularName: "value",
    pluralName: "values",
    uri: "https://example.com/value",
    description: "Untyped values",
    untyped: true,
    range: ["https://example.com/Value"] as [TypeUri],
  };

  ok(isNonFunctionalProperty(property));
  ok(!hasSingularAccessor(property));
});
