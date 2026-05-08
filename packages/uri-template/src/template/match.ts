import { operatorSpecs } from "../const.ts";
import type {
  AssociativeValue,
  ExpandContext,
  ExpandValue,
  OperatorSpec,
  TemplateOptions,
  Token,
  VarSpec,
} from "../types.ts";
import { encodeName, isVarcharAt, truncateValue } from "./encoding.ts";
import expand from "./expand.ts";

/**
 * Matches a URI against a parsed URI template and extracts variable bindings.
 *
 * The inverse of {@link expand}: given the token stream produced by parsing a
 * template and a concrete URI, recovers an {@link ExpandContext} such that
 * re-expanding the template with that context reproduces the original URI.
 *
 * @param tokens The parsed template tokens to match against.
 * @param uri The concrete URI to decompose.
 * @param options Template options shared with the expansion side.
 * @returns The recovered variable context, or `null` if the URI does not match
 *   the template under any interpretation.
 */
export default function match(
  tokens: readonly Token[],
  uri: string,
  options: TemplateOptions,
): ExpandContext | null {
  return matchTokens(tokens, uri, options, 0, 0, {});
}

interface Binding {
  readonly prefix?: number;
  readonly value: ExpandValue;
}

type Bindings = Record<string, Binding>;

interface NamedPart {
  readonly name: string;
  readonly value: string;
}

interface ConsumedParts {
  readonly bindings: Bindings;
  readonly index: number;
}

/**
 * Walks the token stream and the URI in lockstep, backtracking over every
 * candidate decomposition until one survives roundtrip verification.
 *
 * Literal tokens advance deterministically; expression tokens fan out across
 * all viable end positions and value interpretations. When the token stream is
 * exhausted, the accumulated bindings are accepted only if re-expanding the
 * template with them yields the original URI exactly — this is what filters
 * out the spurious interpretations that the permissive parsing stage admits.
 *
 * @returns The first surviving context, or `null` if every branch fails.
 */
function matchTokens(
  tokens: readonly Token[],
  uri: string,
  options: TemplateOptions,
  tokenIndex: number,
  uriIndex: number,
  bindings: Bindings,
): ExpandContext | null {
  if (tokenIndex >= tokens.length) {
    if (uriIndex !== uri.length) return null;
    const context = toExpandContext(bindings);
    return expand(tokens, context, options) === uri ? context : null;
  }

  const token = tokens[tokenIndex];
  if (token.kind === "literal") {
    return uri.startsWith(token.text, uriIndex)
      ? matchTokens(
        tokens,
        uri,
        options,
        tokenIndex + 1,
        uriIndex + token.text.length,
        bindings,
      )
      : null;
  }

  for (const end of expressionEnds(tokens, uri, tokenIndex, uriIndex)) {
    const expression = uri.slice(uriIndex, end);
    for (
      const expressionBindings of matchExpression(
        token.vars,
        token.operator,
        expression,
      )
    ) {
      const merged = mergeBindings(bindings, expressionBindings);
      if (merged == null) continue;
      const result = matchTokens(
        tokens,
        uri,
        options,
        tokenIndex + 1,
        end,
        merged,
      );
      if (result != null) return result;
    }
  }

  return null;
}

/**
 * Generates candidate end positions in the URI for the expression token at
 * `tokenIndex`, using the next non-empty literal token as a search anchor.
 *
 * If no following literal exists the expression may run to the end of the URI,
 * so every position from the URI end back to `uriIndex` is yielded (longest
 * first, biasing the search toward greedy matches). Otherwise only the offsets
 * where the next literal appears are returned, which prunes the search space
 * dramatically in templates with structural separators.
 */
function* expressionEnds(
  tokens: readonly Token[],
  uri: string,
  tokenIndex: number,
  uriIndex: number,
): Generator<number, void, unknown> {
  const nextLiteral = tokens
    .slice(tokenIndex + 1)
    .find((token) => token.kind === "literal" && token.text !== "");

  if (nextLiteral == null || nextLiteral.kind !== "literal") {
    yield* range(uri.length, uriIndex);
    return;
  }

  for (
    let index = uri.indexOf(nextLiteral.text, uriIndex);
    index >= 0;
    index = uri.indexOf(nextLiteral.text, index + 1)
  ) {
    yield index;
  }
}

function* range(from: number, to: number): Generator<number, void, unknown> {
  for (let value = from; value >= to; value--) yield value;
}

/**
 * Decomposes a single expression substring into every plausible binding set.
 *
 * Validates the operator's leading sigil (`?`, `#`, `/`, etc.), strips it, and
 * dispatches to the named or unnamed parser based on the operator spec. The
 * empty-expression case is delegated to {@link matchEmptyExpression}, which
 * decides when an empty expression substring may be read back as an
 * empty-string binding rather than as no binding at all.
 */
function* matchExpression(
  vars: readonly VarSpec[],
  operator: keyof typeof operatorSpecs,
  expression: string,
): Generator<Bindings, void, unknown> {
  if (expression === "") {
    yield* matchEmptyExpression(vars, operator);
    return;
  }

  const spec = operatorSpecs[operator];
  if (!expression.startsWith(spec.first)) return;

  const body = expression.slice(spec.first.length);
  yield* (spec.named
    ? matchNamedExpression(vars, spec, body)
    : matchUnnamedExpression(vars, spec, body));
}

const matchEmptyExpression = (
  vars: readonly VarSpec[],
  operator: keyof typeof operatorSpecs,
): Bindings[] => {
  if ((operator === "" || operator === "+") && vars.length === 1) {
    return [bindValue(vars[0], "")];
  }
  return [{}];
};

const matchUnnamedExpression = (
  vars: readonly VarSpec[],
  spec: OperatorSpec,
  body: string,
): Generator<Bindings, void, unknown> =>
  matchUnnamedFrom(vars, spec, split(body, spec.sep), 0, 0);

/**
 * Distributes the separator-split parts of an unnamed expression across the
 * remaining variables via backtracking.
 *
 * For each variable, every contiguous slice of parts that respects the
 * `minLength`/`maxLength` budget is tried as that variable's value, and the
 * variable may also be skipped entirely (consuming zero parts) to handle
 * undefined variables in the template. Surviving combinations are yielded for
 * the caller to filter.
 */
function* matchUnnamedFrom(
  vars: readonly VarSpec[],
  spec: OperatorSpec,
  parts: readonly string[],
  varIndex: number,
  partIndex: number,
): Generator<Bindings, void, unknown> {
  if (varIndex >= vars.length) {
    if (partIndex >= parts.length) yield {};
    return;
  }

  const varSpec = vars[varIndex];
  for (
    const consumed of consumeUnnamed(
      varSpec,
      spec,
      parts,
      partIndex,
      vars,
      varIndex,
    )
  ) {
    for (
      const rest of matchUnnamedFrom(
        vars,
        spec,
        parts,
        varIndex + 1,
        consumed.index,
      )
    ) {
      const merged = mergeBindings(consumed.bindings, rest);
      if (merged != null) yield merged;
    }
  }

  yield* matchUnnamedFrom(vars, spec, parts, varIndex + 1, partIndex);
}

/**
 * Enumerates every (binding, next-part-index) pair produced by letting one
 * unnamed variable consume between `minLength` and `maxLength` of the
 * remaining parts.
 *
 * The length range is intentionally broad — neither bound is tightened to the
 * exact count of variables remaining after the current one — and the
 * recursive matching in {@link matchUnnamedFrom} discards invalid
 * distributions.
 */
function* consumeUnnamed(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly string[],
  partIndex: number,
  vars: readonly VarSpec[],
  varIndex: number,
): Generator<ConsumedParts, void, unknown> {
  if (partIndex >= parts.length) return;

  const maxLength = parts.length - partIndex;
  const minLength = Math.max(
    1,
    parts.length - partIndex - remainingVars(vars, varIndex),
  );
  for (let length = minLength; length <= maxLength; length++) {
    const slice = parts.slice(partIndex, partIndex + length);
    for (const bindings of parseUnnamedValue(varSpec, spec, slice)) {
      yield { bindings, index: partIndex + length };
    }
  }
}

const remainingVars = (
  vars: readonly VarSpec[],
  varIndex: number,
): number => Math.max(0, vars.length - varIndex - 1);

/**
 * Yields every binding interpretation of a slice assigned to one unnamed
 * variable: scalar, comma-list, associative, and (for explode) an
 * exploded list or associative reading of the same parts.
 *
 * Prefix-bound variables collapse to the scalar reading only.
 */
function* parseUnnamedValue(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly string[],
): Generator<Bindings, void, unknown> {
  const joined = parts.join(spec.sep);
  const nonExploded = parseNonExplodedValue(varSpec, spec, joined);
  if (varSpec.prefix != null) {
    yield* nonExploded;
    return;
  }

  if (varSpec.explode && parts.length > 0) {
    yield* parseExplodedUnnamed(varSpec, spec, parts);
  }
  yield* nonExploded;
}

function* parseExplodedUnnamed(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly string[],
): Generator<Bindings, void, unknown> {
  const decodedList = decodeValues(parts, spec.allowReserved);
  if (decodedList == null) return;

  const object = parseExplodedAssociative(parts, spec);
  if (object != null) yield bindValue(varSpec, object);
  yield bindValue(varSpec, decodedList);
}

const parseExplodedAssociative = (
  parts: readonly string[],
  spec: OperatorSpec,
): AssociativeValue | null =>
  parseExplodedAssociativeBody(parts.join(spec.sep), spec);

function parseExplodedAssociativeBody(
  body: string,
  spec: OperatorSpec,
): AssociativeValue | null {
  const entries: [string, string][] = [];

  for (let index = 0; index < body.length;) {
    const equals = body.indexOf("=", index);
    if (equals < 0) return null;

    const valueStart = equals + 1;
    const valueEnd = findExplodedPairBoundary(body, valueStart, spec.sep);
    const key = decodeValue(body.slice(index, equals), spec.allowReserved);
    const value = decodeValue(
      body.slice(valueStart, valueEnd),
      spec.allowReserved,
    );
    if (key == null || value == null) return null;

    entries.push([key, value]);
    index = valueEnd + spec.sep.length;
  }

  return entries.length < 1 ? null : Object.fromEntries(entries);
}

function findExplodedPairBoundary(
  body: string,
  start: number,
  separator: string,
): number {
  for (let index = start; index < body.length; index++) {
    if (isExplodedPairBoundary(body, index, separator)) return index;
  }
  return body.length;
}

const isExplodedPairBoundary = (
  body: string,
  index: number,
  separator: string,
): boolean => {
  if (!body.startsWith(separator, index)) return false;

  const keyStart = index + separator.length;
  const keyEnd = readPairKeyEnd(body, keyStart);
  return keyEnd > keyStart && body[keyEnd] === "=";
};

function readPairKeyEnd(body: string, start: number): number {
  let index = start;
  let expectVarchar = true;
  while (index < body.length) {
    const varcharLength = isVarcharAt(body, index);
    if (varcharLength > 0) {
      index += varcharLength;
      expectVarchar = false;
      continue;
    }
    if (body[index] !== ".") break;
    if (expectVarchar || isVarcharAt(body, index + 1) < 1) break;
    index++;
    expectVarchar = true;
  }
  return index;
}

/**
 * Yields candidate readings of a single value string under non-exploded
 * encoding: scalar, comma-separated list, and (when an even element count
 * permits) comma-separated associative array. Some candidates will not
 * round-trip — for instance a comma-bearing scalar gets re-encoded with
 * `%2C` on expansion — and are filtered out by the roundtrip check in
 * {@link matchTokens}.
 *
 * The yielded bindings are ordered from most structured to least, so the
 * surrounding backtracking tries the richer interpretations before the scalar
 * one.
 */
function* parseNonExplodedValue(
  varSpec: VarSpec,
  spec: OperatorSpec,
  value: string,
): Generator<Bindings, void, unknown> {
  const primitive = decodeValue(value, spec.allowReserved);
  if (primitive == null) return;

  const primitiveBinding = bindValue(varSpec, primitive);
  if (varSpec.prefix != null) {
    yield primitiveBinding;
    return;
  }

  const commaParts = split(value, ",");
  if (commaParts.length < 2) {
    yield primitiveBinding;
    return;
  }

  const decodedList = decodeValues(commaParts, spec.allowReserved);
  if (decodedList == null) {
    yield primitiveBinding;
    return;
  }

  const associative = commaParts.length % 2 === 0
    ? parseAssociative(commaParts, spec.allowReserved)
    : null;

  if (associative != null) yield bindValue(varSpec, associative);
  yield bindValue(varSpec, decodedList);
  yield primitiveBinding;
}

const matchNamedExpression = (
  vars: readonly VarSpec[],
  spec: OperatorSpec,
  body: string,
): Generator<Bindings, void, unknown> =>
  matchNamedFrom(vars, spec, split(body, spec.sep).map(splitNamedPart), 0, 0);

/**
 * Named-expression counterpart of {@link matchUnnamedFrom}: backtracks over
 * `name=value` parts assigning them to declared variables.
 *
 * Like the unnamed variant, each variable may either consume a contiguous run
 * of parts (via {@link consumeNamed}) or be skipped entirely so that variables
 * absent from the URI remain unbound.
 */
function* matchNamedFrom(
  vars: readonly VarSpec[],
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  varIndex: number,
  partIndex: number,
): Generator<Bindings, void, unknown> {
  if (varIndex >= vars.length) {
    if (partIndex >= parts.length) yield {};
    return;
  }

  const varSpec = vars[varIndex];
  for (
    const consumed of consumeNamed(varSpec, spec, parts, partIndex, vars)
  ) {
    for (
      const rest of matchNamedFrom(
        vars,
        spec,
        parts,
        varIndex + 1,
        consumed.index,
      )
    ) {
      const merged = mergeBindings(consumed.bindings, rest);
      if (merged != null) yield merged;
    }
  }

  yield* matchNamedFrom(vars, spec, parts, varIndex + 1, partIndex);
}

function* consumeNamed(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  partIndex: number,
  vars: readonly VarSpec[],
): Generator<ConsumedParts, void, unknown> {
  if (partIndex >= parts.length) return;

  if (varSpec.explode && varSpec.prefix == null) {
    yield* consumeExplodedNamed(varSpec, spec, parts, partIndex, vars);
    return;
  }

  yield* consumeNamedValue(varSpec, spec, parts, partIndex);
}

function* consumeNamedValue(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  partIndex: number,
): Generator<ConsumedParts, void, unknown> {
  const part = parts[partIndex];
  if (part.name !== encodeName(varSpec.name)) return;

  for (const bindings of parseNonExplodedValue(varSpec, spec, part.value)) {
    yield { bindings, index: partIndex + 1 };
  }
}

function* consumeExplodedNamed(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  partIndex: number,
  vars: readonly VarSpec[],
): Generator<ConsumedParts, void, unknown> {
  yield* consumeNamedList(varSpec, spec, parts, partIndex);
  yield* consumeNamedAssociative(varSpec, spec, parts, partIndex, vars);
}

/**
 * Reads consecutive parts that share the variable's name, decoding each as a
 * list element. Used for the explode-as-list interpretation of a named
 * variable.
 */
function* consumeNamedList(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  partIndex: number,
): Generator<ConsumedParts> {
  const name = encodeName(varSpec.name);
  const values = [...namedListValues(name, spec, parts, partIndex)];

  if (values.length > 0) {
    yield {
      bindings: bindValue(varSpec, values),
      index: partIndex + values.length,
    };
  }
}

function* namedListValues(
  name: string,
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  partIndex: number,
): Generator<string, void, unknown> {
  for (
    let index = partIndex;
    index < parts.length && parts[index].name === name;
    index++
  ) {
    const value = decodeValue(parts[index].value, spec.allowReserved);
    if (value == null) return;
    yield value;
  }
}

/**
 * Reads consecutive parts as `key=value` entries of an associative array under
 * one named exploded variable.
 *
 * After the first part, stops as soon as a part's name matches any declared
 * variable so that those parts remain available for their own variables. The
 * first part is always consumed regardless of name to bootstrap the
 * association.
 */
function* consumeNamedAssociative(
  varSpec: VarSpec,
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  partIndex: number,
  vars: readonly VarSpec[],
): Generator<ConsumedParts, void, unknown> {
  const reservedNames = new Set(vars.map((item) => encodeName(item.name)));
  const entries = [
    ...namedAssociativeEntries(spec, parts, partIndex, reservedNames),
  ];

  if (entries.length > 0) {
    yield {
      bindings: bindValue(varSpec, Object.fromEntries(entries)),
      index: partIndex + entries.length,
    };
  }
}

function* namedAssociativeEntries(
  spec: OperatorSpec,
  parts: readonly NamedPart[],
  partIndex: number,
  reservedNames: ReadonlySet<string>,
): Generator<readonly [string, string], void, unknown> {
  for (let index = partIndex; index < parts.length; index++) {
    const part = parts[index];
    if (index > partIndex && reservedNames.has(part.name)) return;
    const key = decodeValue(part.name, spec.allowReserved);
    const value = decodeValue(part.value, spec.allowReserved);
    if (key == null || value == null) return;
    yield [key, value];
  }
}

function splitNamedPart(part: string): NamedPart {
  const equals = part.indexOf("=");
  return equals < 0
    ? { name: part, value: "" }
    : { name: part.slice(0, equals), value: part.slice(equals + 1) };
}

function parseAssociative(
  parts: readonly string[],
  allowReserved: boolean,
): AssociativeValue | null {
  const entries: [string, string][] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const key = decodeValue(parts[index], allowReserved);
    const value = decodeValue(parts[index + 1], allowReserved);
    if (key == null || value == null) return null;
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function decodeValues(
  values: readonly string[],
  allowReserved: boolean,
): string[] | null {
  const decoded: string[] = [];
  for (const value of values) {
    const item = decodeValue(value, allowReserved);
    if (item == null) return null;
    decoded.push(item);
  }
  return decoded;
}

function decodeValue(value: string, allowReserved: boolean): string | null {
  if (allowReserved) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

const bindValue = (
  { name, prefix }: VarSpec,
  value: ExpandValue,
): Bindings => ({ [name]: { value, prefix } });

/**
 * Combines two binding sets, returning `null` if any shared variable receives
 * incompatible values across them.
 *
 * Equality of values and prefix-aware compatibility (one binding being a
 * truncation of the other) are both delegated to {@link mergeBinding}.
 */
function mergeBindings(left: Bindings, right: Bindings): Bindings | null {
  const merged: Bindings = { ...left };
  for (const [name, binding] of Object.entries(right)) {
    const existing = merged[name];
    if (existing == null) {
      merged[name] = binding;
      continue;
    }

    const next = mergeBinding(existing, binding);
    if (next == null) return null;
    merged[name] = next;
  }
  return merged;
}

const mergeBinding = (left: Binding, right: Binding): Binding | null =>
  isPrefixBinding(left) || isPrefixBinding(right)
    ? mergePrefixBinding(left, right)
    : equalExpandValue(left.value, right.value)
    ? left
    : null;

/**
 * Reconciles two bindings when at least one carries a prefix limit, by
 * checking that the truncation of the longer (or unrestricted) value matches
 * the shorter prefixed value.
 *
 * Returns the binding that carries the more complete information, or `null`
 * when no consistent reading exists or non-string values are involved.
 */
function mergePrefixBinding(left: Binding, right: Binding): Binding | null {
  const leftValue = primitiveString(left.value);
  const rightValue = primitiveString(right.value);
  if (leftValue == null || rightValue == null) return null;

  const isLeftPrefix = isPrefixBinding(left);
  const isRightPrefix = isPrefixBinding(right);
  if (!isLeftPrefix && !isRightPrefix) return null;

  if (isLeftPrefix && !isRightPrefix) {
    return truncateValue(rightValue, left.prefix) === leftValue ? right : null;
  }

  if (!isLeftPrefix && isRightPrefix) {
    return truncateValue(leftValue, right.prefix) === rightValue ? left : null;
  }

  const leftPrefix = left.prefix!;
  const rightPrefix = right.prefix!;
  if (leftPrefix <= rightPrefix) {
    return truncateValue(rightValue, leftPrefix) === leftValue ? right : null;
  }
  return truncateValue(leftValue, rightPrefix) === rightValue ? left : null;
}

const isPrefixBinding = (
  binding: Binding,
): binding is Binding & { readonly prefix: number } => binding.prefix != null;

const primitiveString = (value: ExpandValue): string | null =>
  typeof value === "string" ? value : null;

function equalExpandValue(left: ExpandValue, right: ExpandValue): boolean {
  if (Array.isArray(left)) {
    return Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => item === right[index]);
  }

  if (isAssociative(left)) {
    return isAssociative(right) &&
      equalEntries(Object.entries(left), Object.entries(right));
  }

  return left === right;
}

const equalEntries = (
  left: readonly (readonly [string, unknown])[],
  right: readonly (readonly [string, unknown])[],
): boolean =>
  left.length === right.length &&
  left.every(([key, value], index) => {
    const [rightKey, rightValue] = right[index];
    return key === rightKey && value === rightValue;
  });

const isAssociative = (value: ExpandValue): value is AssociativeValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toExpandContext = (bindings: Bindings): ExpandContext =>
  Object.fromEntries(
    Object.entries(bindings)
      .map(([key, binding]) => [key, binding.value]),
  );

const split = (value: string, separator: string): string[] =>
  separator === "" ? [value] : value.split(separator);
