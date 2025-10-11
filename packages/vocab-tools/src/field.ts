import { encodeBase58 } from "byte-encodings/base58";
import type { PropertySchema, TypeSchema } from "./schema.ts";
import { areAllScalarTypes, getTypeNames } from "./type.ts";

export async function getFieldName(
  propertyUri: string,
  prefix = "#",
): Promise<string> {
  const hashedUri = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(propertyUri),
  );
  const match = propertyUri.match(/#([A-Za-z0-9_]+)$/);
  const suffix = match == null ? "" : `_${match[1]}`;
  return `${prefix}_${encodeBase58(hashedUri)}${suffix}`;
}

export async function generateField(
  property: PropertySchema,
  types: Record<string, TypeSchema>,
  prefix = "#",
): Promise<string> {
  const fieldName = await getFieldName(property.uri, prefix);
  if (areAllScalarTypes(property.range, types)) {
    return `${fieldName}: (${
      getTypeNames(property.range, types, true)
    })[] = [];\n`;
  } else {
    const typeNames = getTypeNames(property.range, types);
    const trustFieldName = await getFieldName(property.uri, `${prefix}_trust`);
    return `
      ${fieldName}: (${typeNames} | URL)[] = [];
      ${trustFieldName}: Set<number> = new Set();
    `;
  }
}

export async function* generateFields(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  for (const property of type.properties) {
    yield await generateField(property, types);
  }
}
