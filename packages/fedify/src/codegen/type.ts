import type { PropertySchema, TypeSchema } from "./schema.ts";

// The list of JSON-LD contexts to apply heuristics that bypass the proper
// JSON-LD processor.
const HEURISTICS_CONTEXTS: string[] = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  "https://w3id.org/security/data-integrity/v1",
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/multikey/v1",
];

interface ScalarType {
  name: string;
  typeGuard(variable: string): string;
  encoder(variable: string): string;
  compactEncoder?: (variable: string) => string;
  dataCheck(variable: string): string;
  decoder(variable: string, baseUrlVar: string): string;
}

const scalarTypes: Record<string, ScalarType> = {
  "http://www.w3.org/2001/XMLSchema#boolean": {
    name: "boolean",
    typeGuard(v) {
      return `typeof ${v} === "boolean"`;
    },
    encoder(v) {
      return `{ "@value": ${v} }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && typeof ${v}["@value"] === "boolean"`;
    },
    decoder(v) {
      return `${v}["@value"]`;
    },
  },
  "http://www.w3.org/2001/XMLSchema#integer": {
    name: "number",
    typeGuard(v) {
      return `typeof ${v} === "number" && Number.isInteger(${v})`;
    },
    encoder(v) {
      return `{
        "@type": "http://www.w3.org/2001/XMLSchema#integer",
        "@value": ${v},
      }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@type" in ${v}
        && ${v}["@type"] === "http://www.w3.org/2001/XMLSchema#integer"
        && "@value" in ${v} && typeof ${v}["@value"] === "number"`;
    },
    decoder(v) {
      return `${v}["@value"] as number`;
    },
  },
  "http://www.w3.org/2001/XMLSchema#nonNegativeInteger": {
    name: "number",
    typeGuard(v) {
      return `typeof ${v} === "number" && Number.isInteger(${v}) && ${v} >= 0`;
    },
    encoder(v) {
      return `{
        "@type": "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
        "@value": ${v},
      }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@type" in ${v}
        && ${v}["@type"] === "http://www.w3.org/2001/XMLSchema#nonNegativeInteger"
        && "@value" in ${v} && typeof ${v}["@value"] === "number"`;
    },
    decoder(v) {
      return `${v}["@value"]`;
    },
  },
  "http://www.w3.org/2001/XMLSchema#float": {
    name: "number",
    typeGuard(v) {
      return `typeof ${v} === "number" && !Number.isNaN(${v})`;
    },
    encoder(v) {
      return `{
        "@type": "http://www.w3.org/2001/XMLSchema#float",
        "@value": ${v},
      }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@type" in ${v}
        && ${v}["@type"] === "http://www.w3.org/2001/XMLSchema#float"
        && "@value" in ${v} && typeof ${v}["@value"] === "number"`;
    },
    decoder(v) {
      return `${v}["@value"]`;
    },
  },
  "http://www.w3.org/2001/XMLSchema#string": {
    name: "string",
    typeGuard(v) {
      return `typeof ${v} === "string"`;
    },
    encoder(v) {
      return `{ "@value": ${v} }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && typeof ${v}["@value"] === "string" && !("@language" in ${v})`;
    },
    decoder(v) {
      return `${v}["@value"]`;
    },
  },
  "http://www.w3.org/2001/XMLSchema#anyURI": {
    name: "URL",
    typeGuard(v) {
      return `${v} instanceof URL`;
    },
    encoder(v) {
      return `{ "@id": ${v}.href }`;
    },
    compactEncoder(v) {
      return `${v}.href`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@id" in ${v}
        && typeof ${v}["@id"] === "string"
        && ${v}["@id"] !== ""`;
    },
    decoder(v, baseUrlVar) {
      return `${v}["@id"].startsWith("at://")
        ? new URL("at://" +
          encodeURIComponent(
            ${v}["@id"].includes("/", 5)
              ? ${v}["@id"].slice(5, ${v}["@id"].indexOf("/", 5))
              : ${v}["@id"].slice(5)
          ) +
          (
            ${v}["@id"].includes("/", 5)
              ? ${v}["@id"].slice(${v}["@id"].indexOf("/", 5))
              : ""
          )
        )
        : URL.canParse(${v}["@id"]) && ${baseUrlVar}
          ? new URL(${v}["@id"])
          : new URL(${v}["@id"], ${baseUrlVar})`;
    },
  },
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString": {
    name: "LanguageString",
    typeGuard(v) {
      return `${v} instanceof LanguageString`;
    },
    encoder(v) {
      return `{
        "@value": ${v}.toString(),
        "@language": ${v}.language.compact(),
      }`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@language" in ${v} && "@value" in ${v}
        && typeof ${v}["@language"] === "string"
        && typeof ${v}["@value"] === "string"`;
    },
    decoder(v) {
      return `new LanguageString(${v}["@value"], ${v}["@language"])`;
    },
  },
  "http://www.w3.org/2001/XMLSchema#dateTime": {
    name: "Temporal.Instant",
    typeGuard(v) {
      return `${v} instanceof Temporal.Instant`;
    },
    encoder(v) {
      return `{
        "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
        "@value": ${v}.toString(),
      }`;
    },
    compactEncoder(v) {
      return `${v}.toString()`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@type" in ${v}
        && "@value" in ${v} && typeof ${v}["@value"] === "string"
        && ${v}["@type"] === "http://www.w3.org/2001/XMLSchema#dateTime"
        // Check if the value is a valid RFC 3339 date-time string
        && new Date(${v}["@value"]).toString() !== "Invalid Date"
        `;
    },
    decoder(v) {
      return `Temporal.Instant.from(
        ${v}["@value"].substring(19).match(/[Z+-]/)
          ? ${v}["@value"]
          : ${v}["@value"] + "Z"
      )`;
    },
  },
  "http://www.w3.org/2001/XMLSchema#duration": {
    name: "Temporal.Duration",
    typeGuard(v) {
      return `${v} instanceof Temporal.Duration`;
    },
    encoder(v) {
      return `{
        "@type": "http://www.w3.org/2001/XMLSchema#duration",
        "@value": ${v}.toString(),
      }`;
    },
    compactEncoder(v) {
      return `${v}.toString()`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@type" in ${v}
        && "@value" in ${v} && typeof ${v}["@value"] === "string"
        && ${v}["@type"] === "http://www.w3.org/2001/XMLSchema#duration"`;
    },
    decoder(v) {
      return `Temporal.Duration.from(${v}["@value"])`;
    },
  },
  "https://w3id.org/security#cryptosuiteString": {
    name: '"eddsa-jcs-2022"',
    typeGuard(v) {
      return `${v} == "eddsa-jcs-2022"`;
    },
    encoder(v) {
      return `{ "@value": ${v} }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && !("@language" in ${v}) && ${v}["@value"] === "eddsa-jcs-2022"`;
    },
    decoder(v) {
      return `${v}["@value"]`;
    },
  },
  "https://w3id.org/security#multibase": {
    name: "Uint8Array",
    typeGuard(v) {
      return `${v} instanceof Uint8Array`;
    },
    encoder(v) {
      return `{
        "@type": "https://w3id.org/security#multibase",
        "@value": new TextDecoder().decode(encodeMultibase("base58btc", ${v})),
      }`;
    },
    compactEncoder(v) {
      return `new TextDecoder().decode(encodeMultibase("base58btc", ${v}))`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && typeof ${v}["@value"] === "string"`;
    },
    decoder(v) {
      return `decodeMultibase(${v}["@value"])`;
    },
  },
  "fedify:langTag": {
    name: "LanguageTag",
    typeGuard(v) {
      return `${v} instanceof LanguageTag`;
    },
    encoder(v) {
      return `{ "@value": ${v}.compact() }`;
    },
    compactEncoder(v) {
      return `${v}.compact()`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && typeof ${v}["@value"] === "string" && !("@language" in ${v})`;
    },
    decoder(v) {
      return `parseLanguageTag(${v}["@value"])`;
    },
  },
  "fedify:url": {
    name: "URL",
    typeGuard(v) {
      return `${v} instanceof URL`;
    },
    encoder(v) {
      return `{ "@value": ${v}.href }`;
    },
    compactEncoder(v) {
      return `${v}.href`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && typeof ${v}["@value"] === "string"
        && ${v}["@value"] !== "" && ${v}["@value"] !== "/"`;
    },
    decoder(v) {
      return `new URL(${v}["@value"])`;
    },
  },
  "fedify:publicKey": {
    name: "CryptoKey",
    typeGuard(v) {
      return `
        // @ts-ignore: CryptoKey exists in the global scope.
        ${v} instanceof CryptoKey
      `;
    },
    encoder(v) {
      return `{ "@value": await exportSpki(${v}) }`;
    },
    compactEncoder(v) {
      return `await exportSpki(${v})`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && typeof ${v}["@value"] === "string"`;
    },
    decoder(v) {
      return `await importPem(${v}["@value"])`;
    },
  },
  "fedify:multibaseKey": {
    name: "CryptoKey",
    typeGuard(v) {
      return `
        // @ts-ignore: CryptoKey exists in the global scope.
        ${v} instanceof CryptoKey
      `;
    },
    encoder(v) {
      return `{
        "@type": "https://w3id.org/security#multibase",
        "@value": await exportMultibaseKey(${v}),
      }`;
    },
    compactEncoder(v) {
      return `await exportMultibaseKey(${v})`;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
        && typeof ${v}["@value"] === "string"`;
    },
    decoder(v) {
      return `await importMultibaseKey(${v}["@value"])`;
    },
  },
  "fedify:proofPurpose": {
    name: '"assertionMethod" | "authentication" | "capabilityInvocation" | ' +
      '"capabilityDelegation" | "keyAgreement"',
    typeGuard(v) {
      return `${v} === "assertionMethod" || ${v} === "authentication" ||
        ${v} === "capabilityInvocation" || ${v} === "capabilityDelegation" ||
        ${v} === "keyAgreement"`;
    },
    encoder(v) {
      return `{
        "@id": "https://w3id.org/security#" + ${v},
      }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@id" in ${v}
        && typeof ${v}["@id"] === "string"
        && ${v}["@id"].startsWith("https://w3id.org/security#")
        && [
          "assertionMethod", "authentication", "capabilityInvocation",
          "capabilityDelegation", "keyAgreement",
        ].includes(${v}["@id"].substring(26))`;
    },
    decoder(v) {
      return `${v}["@id"].substring(26)`;
    },
  },
  "fedify:units": {
    name: '"cm" | "feet" | "inches" | "km" | "m" | "miles"',
    typeGuard(v) {
      return `${v} == "cm" || ${v} == "feet" || ${v} == "inches" ` +
        `|| ${v} == "km" || ${v} == "m" || ${v} == "miles"`;
    },
    encoder(v) {
      return `{ "@value": ${v} }`;
    },
    compactEncoder(v) {
      return v;
    },
    dataCheck(v) {
      return `typeof ${v} === "object" && "@value" in ${v}
      && (${v}["@value"] == "cm" || ${v}["@value"] == "feet" ` +
        `|| ${v}["@value"] == "inches" || ${v}["@value"] == "km" ` +
        `|| ${v}["@value"] == "m" || ${v}["@value"] == "miles")`;
    },
    decoder(v) {
      return `${v}["@value"]`;
    },
  },
};

export function getTypeName(
  typeUri: string,
  types: Record<string, TypeSchema>,
): string {
  if (typeUri in types) return types[typeUri].name;
  if (typeUri in scalarTypes) return scalarTypes[typeUri].name;
  throw new Error(`Unknown type: ${typeUri}`);
}

export function getTypeNames(
  typeUris: string[],
  types: Record<string, TypeSchema>,
  parentheses = false,
): string {
  if (typeUris.length < 1) return "never";
  else if (typeUris.length === 1) return getTypeName(typeUris[0], types);
  let typeNames = typeUris.map((typeUri) => getTypeName(typeUri, types));
  typeNames = typeNames.filter((t, i) => typeNames.indexOf(t) === i);
  const t = typeNames.join(" | ");
  return parentheses && typeNames.length > 1 ? `(${t})` : t;
}

export function isScalarType(
  typeUri: string,
  types: Record<string, TypeSchema>,
): boolean {
  if (typeUri in scalarTypes) return true;
  else if (typeUri in types) return !types[typeUri].entity;
  throw new Error(`Unknown type: ${typeUri}`);
}

export function areAllScalarTypes(
  typeUris: string[],
  types: Record<string, TypeSchema>,
): boolean {
  return typeUris.every((typeUri) => isScalarType(typeUri, types));
}

export function isCompactableType(
  typeUri: string,
  types: Record<string, TypeSchema>,
): boolean {
  if (typeUri in scalarTypes) {
    return scalarTypes[typeUri].compactEncoder != null;
  } else if (typeUri in types) {
    const type = types[typeUri];
    if (type.compactName == null) return false;
    else if (type.extends != null && !isCompactableType(type.extends, types)) {
      return false;
    }
    const defaultContext = type.defaultContext;
    return defaultContext != null &&
        HEURISTICS_CONTEXTS.includes(defaultContext as string) ||
      Array.isArray(defaultContext) &&
        (defaultContext as string[]).some(
          HEURISTICS_CONTEXTS.includes.bind(HEURISTICS_CONTEXTS),
        );
  }
  throw new Error(`Unknown type: ${typeUri}`);
}

export function getSubtypes(
  typeUri: string,
  types: Record<string, TypeSchema>,
  excludeSelf = false,
): string[] {
  const subtypes: string[] = excludeSelf ? [] : [typeUri];
  for (const uri in types) {
    const type = types[uri];
    if (type.extends === typeUri) subtypes.push(...getSubtypes(uri, types));
  }
  return subtypes.filter((t, i) => subtypes.indexOf(t) === i);
}

export function getSupertypes(
  typeUri: string,
  types: Record<string, TypeSchema>,
  excludeSelf = false,
): string[] {
  const supertypes: string[] = excludeSelf ? [] : [typeUri];
  const type = types[typeUri];
  if (type.extends) supertypes.push(...getSupertypes(type.extends, types));
  return supertypes;
}

export function* getAllProperties(
  typeUri: string,
  types: Record<string, TypeSchema>,
  excludeSelf = false,
): Iterable<PropertySchema> {
  for (const t of getSupertypes(typeUri, types, excludeSelf)) {
    if (!(t in types)) continue;
    for (const prop of types[t].properties) yield prop;
  }
}

export function getEncoder(
  typeUri: string,
  types: Record<string, TypeSchema>,
  variable: string,
  optionsVariable: string,
  compact = false,
): string {
  if (typeUri in scalarTypes) {
    return compact
      ? scalarTypes[typeUri].compactEncoder?.(variable) ??
        scalarTypes[typeUri].encoder(variable)
      : scalarTypes[typeUri].encoder(variable);
  }
  if (typeUri in types) {
    return compact
      ? `await ${variable}.toJsonLd({
           ...(${optionsVariable}),
           format: undefined,
           context: undefined,
         })`
      : `await ${variable}.toJsonLd(${optionsVariable})`;
  }
  throw new Error(`Unknown type: ${typeUri}`);
}

export function getTypeGuard(
  typeUri: string,
  types: Record<string, TypeSchema>,
  variable: string,
): string {
  if (typeUri in scalarTypes) return scalarTypes[typeUri].typeGuard(variable);
  if (typeUri in types) return `${variable} instanceof ${types[typeUri].name}`;
  throw new Error(`Unknown type: ${typeUri}`);
}

export function getTypeGuards(
  typeUris: string[],
  types: Record<string, TypeSchema>,
  variable: string,
): string {
  return typeUris.map((t) => getTypeGuard(t, types, variable)).join(" || ");
}

export function* getEncoders(
  typeUris: string[],
  types: Record<string, TypeSchema>,
  variable: string,
  optionsVariable: string,
  compact = false,
): Iterable<string> {
  let i = typeUris.length;
  for (const typeUri of typeUris) {
    if (--i > 0) {
      yield getTypeGuard(typeUri, types, variable);
      yield " ? ";
    }
    yield getEncoder(typeUri, types, variable, optionsVariable, compact);
    if (i > 0) yield " : ";
  }
}

export function getDecoder(
  typeUri: string,
  types: Record<string, TypeSchema>,
  variable: string,
  optionsVariable: string,
  baseUrlVariable: string,
): string {
  if (typeUri in scalarTypes) {
    return scalarTypes[typeUri].decoder(
      variable,
      baseUrlVariable,
    );
  }
  if (typeUri in types) {
    return `await ${types[typeUri].name}.fromJsonLd(
      ${variable},
      { ...${optionsVariable}, baseUrl: ${baseUrlVariable} }
    )`;
  }
  throw new Error(`Unknown type: ${typeUri}`);
}

export function getDataCheck(
  typeUri: string,
  types: Record<string, TypeSchema>,
  variable: string,
): string {
  if (typeUri in scalarTypes) return scalarTypes[typeUri].dataCheck(variable);
  if (typeUri in types) {
    const subtypes = getSubtypes(typeUri, types);
    return `typeof ${variable} === "object" && "@type" in ${variable}
      && Array.isArray(${variable}["@type"])` +
      (subtypes.length > 1
        ? `&& ${JSON.stringify(subtypes)}.some(
            t => ${variable}["@type"].includes(t))`
        : `&& ${variable}["@type"].includes(${JSON.stringify(typeUri)})`);
  }
  throw new Error(`Unknown type: ${typeUri}`);
}

export function* getDecoders(
  typeUris: string[],
  types: Record<string, TypeSchema>,
  variable: string,
  optionsVariable: string,
  baseUrlVariable: string,
): Iterable<string> {
  for (const typeUri of typeUris) {
    yield getDataCheck(typeUri, types, variable);
    yield " ? ";
    yield getDecoder(
      typeUri,
      types,
      variable,
      optionsVariable,
      baseUrlVariable,
    );
    yield " : ";
  }
  yield "undefined";
}

export function emitOverride(
  typeUri: string,
  types: Record<string, TypeSchema>,
): string {
  if (types[typeUri].extends == null) return "";
  return "override";
}
