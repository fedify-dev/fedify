/*!
 * Adapted directly from negotiator at https://github.com/jshttp/negotiator/
 * which is licensed as follows:
 *
 * (The MIT License)
 *
 * Copyright (c) 2012-2014 Federico Romero
 * Copyright (c) 2012-2014 Isaac Z. Schlueter
 * Copyright (c) 2014-2015 Douglas Christopher Wilson
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

export interface Specificity {
  i: number;
  o: number | undefined;
  q: number;
  s: number | undefined;
}

function compareSpecs(a: Specificity, b: Specificity): number {
  return (
    b.q - a.q ||
    (b.s ?? 0) - (a.s ?? 0) ||
    (a.o ?? 0) - (b.o ?? 0) ||
    a.i - b.i ||
    0
  );
}

function isQuality(spec: Specificity): boolean {
  return spec.q > 0;
}

interface MediaTypeSpecificity extends Specificity {
  type: string;
  subtype: string;
  params: { [param: string]: string | undefined };
}

const simpleMediaTypeRegExp = /^\s*([^\s\/;]+)\/([^;\s]+)\s*(?:;(.*))?$/;

function splitKeyValuePair(str: string): [string, string | undefined] {
  const [key, value] = str.split("=");
  return [key!.toLowerCase(), value];
}

function parseMediaType(
  str: string,
  i: number,
): MediaTypeSpecificity | undefined {
  const match = simpleMediaTypeRegExp.exec(str);

  if (!match) {
    return;
  }

  const [, type, subtype, parameters] = match;
  if (!type || !subtype) {
    return;
  }

  const params: { [param: string]: string | undefined } = Object.create(null);
  let q = 1;
  if (parameters) {
    const kvps = parameters.split(";").map((p) => p.trim()).map(
      splitKeyValuePair,
    );

    for (const [key, val] of kvps) {
      const value = val && val[0] === `"` && val[val.length - 1] === `"`
        ? val.slice(1, val.length - 1)
        : val;

      if (key === "q" && value) {
        q = parseFloat(value);
        break;
      }

      params[key] = value;
    }
  }

  return { type, subtype, params, i, o: undefined, q, s: undefined };
}

function parseAccept(accept: string): MediaTypeSpecificity[] {
  const accepts = accept.split(",").map((p) => p.trim());

  const mediaTypes: MediaTypeSpecificity[] = [];
  for (const [index, accept] of accepts.entries()) {
    const mediaType = parseMediaType(accept.trim(), index);

    if (mediaType) {
      mediaTypes.push(mediaType);
    }
  }

  return mediaTypes;
}

function getFullType(spec: MediaTypeSpecificity) {
  return `${spec.type}/${spec.subtype}`;
}

export function preferredMediaTypes(
  accept?: string | null,
): string[] {
  const accepts = parseAccept(accept === undefined ? "*/*" : accept ?? "");

  return accepts
    .filter(isQuality)
    .sort(compareSpecs)
    .map(getFullType);
}

// cSpell: ignore Schlueter kvps
