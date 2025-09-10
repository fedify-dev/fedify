import { assertEquals, assertThrows } from "@std/assert";
import { parseTemplateFast, type TemplateAST } from "./parser.ts";
import type { ParseError } from "./error.ts";

function extractLiteral(ast: TemplateAST, partIndex: number): string {
  const part = ast.parts[partIndex];
  if (part?.kind !== "Lit") throw new Error("Expected literal");
  return ast.source.slice(part.start, part.end);
}

function extractVarName(
  ast: TemplateAST,
  partIndex: number,
  varIndex: number,
): string {
  const part = ast.parts[partIndex];
  if (part?.kind !== "Expr") throw new Error("Expected expression");
  const varSpec = part.vars[varIndex];
  if (!varSpec) throw new Error("Variable not found");
  return ast.source.slice(varSpec.nameStart, varSpec.nameEnd);
}

Deno.test("Parser: Edge Cases - Unicode and Special Characters", () => {
  // Test 1: Unicode in literals - should preserve exactly
  const unicodeTemplate = "🚀/users/{id}/📁/{file}";
  const unicodeAst = parseTemplateFast(unicodeTemplate);
  assertEquals(extractLiteral(unicodeAst, 0), "🚀/users/");
  assertEquals(extractLiteral(unicodeAst, 2), "/📁/");

  // Test 2: Variable names with dots (allowed per RFC)
  const dotTemplate = "{user.id}/{item.name}";
  const dotAst = parseTemplateFast(dotTemplate);
  assertEquals(extractVarName(dotAst, 0, 0), "user.id");
  assertEquals(extractVarName(dotAst, 2, 0), "item.name");

  // Test 3: Maximum allowed characters in variable name
  const longVarName = "a".repeat(100) + "_b" + "9".repeat(100);
  const longTemplate = `{${longVarName}}`;
  const longAst = parseTemplateFast(longTemplate);
  assertEquals(extractVarName(longAst, 0, 0), longVarName);
});

Deno.test("Parser: Malformed Templates - Critical Error Detection", () => {
  // Test 1: Unclosed expression at various positions
  assertThrows(
    () => parseTemplateFast("/users/{id"),
    Error,
    "Unclosed expression",
  );

  assertThrows(
    () => parseTemplateFast("{"),
    Error,
    "Unclosed expression",
  );

  assertThrows(
    () => parseTemplateFast("/path/{var/next/{other}"),
    Error,
    "Expected ',' or '}'",
  );

  // Test 2: Invalid operator sequences
  assertThrows(
    () => parseTemplateFast("{+}"),
    Error,
    "Empty expression",
    "Strict mode should reject empty expressions",
  );

  // Test 3: Invalid characters in variable names
  assertThrows(
    () => parseTemplateFast("{user-name}"),
    Error,
    "Expected ',' or '}'",
    "Hyphen is not allowed in variable names",
  );

  assertThrows(
    () => parseTemplateFast("{user name}"),
    Error,
    "Expected ',' or '}'",
    "Spaces are not allowed in variable names",
  );

  // Test 4: Invalid modifier syntax
  assertThrows(
    () => parseTemplateFast("{var:}"),
    Error,
    "Expected digits after ':'",
    "Colon without digits should fail in strict mode",
  );

  assertThrows(
    () => parseTemplateFast("{var:0}"),
    Error,
    "Prefix length must be > 0",
    "Zero prefix length is invalid",
  );

  assertThrows(
    () => parseTemplateFast("{var:abc}"),
    Error,
    "Expected digits after ':'",
    "Non-numeric prefix should fail",
  );
});

Deno.test("Parser: Modifier Combinations and Edge Cases", () => {
  // Test 1: Valid modifier combinations
  const validModifiers = parseTemplateFast("{var:100}{var*}{var:50*}");
  const expr1 = validModifiers.parts[0];
  const expr2 = validModifiers.parts[1];
  const expr3 = validModifiers.parts[2];

  if (expr1.kind === "Expr") {
    assertEquals(expr1.vars[0].prefixLen, 100);
    assertEquals(expr1.vars[0].explode, false);
  }

  if (expr2.kind === "Expr") {
    assertEquals(expr2.vars[0].prefixLen, 0);
    assertEquals(expr2.vars[0].explode, true);
  }

  if (expr3.kind === "Expr") {
    assertEquals(expr3.vars[0].prefixLen, 50);
    assertEquals(expr3.vars[0].explode, true);
  }

  // Test 2: Large prefix numbers
  const largePrefix = parseTemplateFast("{var:999999}");
  if (largePrefix.parts[0].kind === "Expr") {
    assertEquals(largePrefix.parts[0].vars[0].prefixLen, 999999);
  }

  // Test 3: Non-standard order in non-strict mode
  const nonStrictAst = parseTemplateFast("{var*:100}", { strict: false });
  if (nonStrictAst.parts[0].kind === "Expr") {
    assertEquals(nonStrictAst.parts[0].vars[0].prefixLen, 100);
    assertEquals(nonStrictAst.parts[0].vars[0].explode, true);
  }

  // Strict mode should only accept RFC order
  const strictAst = parseTemplateFast("{var:100*}", { strict: true });
  if (strictAst.parts[0].kind === "Expr") {
    assertEquals(strictAst.parts[0].vars[0].prefixLen, 100);
    assertEquals(strictAst.parts[0].vars[0].explode, true);
  }
});

Deno.test("Parser: Complex Multi-Variable Expressions", () => {
  // Test 1: Multiple variables with different modifiers
  const multiVar = parseTemplateFast("{?x,y:3,z*}");
  if (multiVar.parts[0].kind === "Expr") {
    const expr = multiVar.parts[0];
    assertEquals(expr.op, "?");
    assertEquals(expr.vars.length, 3);

    assertEquals(extractVarName(multiVar, 0, 0), "x");
    assertEquals(expr.vars[0].prefixLen, 0);
    assertEquals(expr.vars[0].explode, false);

    assertEquals(extractVarName(multiVar, 0, 1), "y");
    assertEquals(expr.vars[1].prefixLen, 3);
    assertEquals(expr.vars[1].explode, false);

    assertEquals(extractVarName(multiVar, 0, 2), "z");
    assertEquals(expr.vars[2].prefixLen, 0);
    assertEquals(expr.vars[2].explode, true);
  }

  // Test 2: All operators with complex patterns
  const operators = [
    { template: "{+path,id}", op: "+" },
    { template: "{#section,subsection}", op: "#" },
    { template: "{/path,to,resource}", op: "/" },
    { template: "{?first,second}", op: "?" },
    { template: "{&continuation}", op: "&" },
  ];

  for (const { template, op } of operators) {
    const ast = parseTemplateFast(template);
    if (ast.parts[0].kind === "Expr") {
      assertEquals(ast.parts[0].op, op);
    }
  }
});

Deno.test("Parser: Boundary Conditions", () => {
  // Test 1: Empty template
  const emptyAst = parseTemplateFast("");
  assertEquals(emptyAst.parts.length, 0);

  // Test 2: Only literals, no expressions
  const literalOnly = parseTemplateFast("/users/all/active");
  assertEquals(literalOnly.parts.length, 1);
  assertEquals(extractLiteral(literalOnly, 0), "/users/all/active");

  // Test 3: Only expression, no literals
  const exprOnly = parseTemplateFast("{id}");
  assertEquals(exprOnly.parts.length, 1);
  if (exprOnly.parts[0].kind === "Expr") {
    assertEquals(extractVarName(exprOnly, 0, 0), "id");
  }

  // Test 4: Adjacent expressions without literals
  const adjacent = parseTemplateFast("{first}{second}{third}");
  assertEquals(adjacent.parts.length, 3);
  assertEquals(extractVarName(adjacent, 0, 0), "first");
  assertEquals(extractVarName(adjacent, 1, 0), "second");
  assertEquals(extractVarName(adjacent, 2, 0), "third");

  // Test 5: Expression at boundaries
  const boundaries = parseTemplateFast("{start}/middle/{end}");
  assertEquals(boundaries.parts.length, 3);
  assertEquals(extractVarName(boundaries, 0, 0), "start");
  assertEquals(extractLiteral(boundaries, 1), "/middle/");
  assertEquals(extractVarName(boundaries, 2, 0), "end");
});

Deno.test("Parser: Reserved Character Handling", () => {
  // Test literals containing characters that would be operators inside expressions
  const reservedInLiteral = parseTemplateFast(
    "path+with#special?chars&more/{id}",
  );
  assertEquals(
    extractLiteral(reservedInLiteral, 0),
    "path+with#special?chars&more/",
  );

  // Test that parser doesn't support doubled braces as escape mechanism
  // RFC 6570 doesn't specify this, so we document this limitation
  assertThrows(
    () => parseTemplateFast("literal{{not-expression}}here/{var}"),
    Error,
    "Empty variable name",
    "Parser treats {{ as start of expression, not as escaped brace",
  );

  // Test with valid variable names to show intended behavior
  const validBraces = parseTemplateFast("literal{var1}between{var2}");
  assertEquals(extractLiteral(validBraces, 0), "literal");
  assertEquals(extractVarName(validBraces, 1, 0), "var1");
  assertEquals(extractLiteral(validBraces, 2), "between");
  assertEquals(extractVarName(validBraces, 3, 0), "var2");
});

Deno.test("Parser: Stress Test - Deeply Nested and Complex Templates", () => {
  // Test 1: Many variables in single expression
  const manyVars = Array.from({ length: 50 }, (_, i) => `var${i}`).join(",");
  const manyVarsTemplate = `{${manyVars}}`;
  const manyVarsAst = parseTemplateFast(manyVarsTemplate);
  if (manyVarsAst.parts[0].kind === "Expr") {
    assertEquals(manyVarsAst.parts[0].vars.length, 50);
  }

  // Test 2: Alternating pattern
  let alternating = "";
  for (let i = 0; i < 20; i++) {
    alternating += `/segment${i}/{var${i}}`;
  }
  const altAst = parseTemplateFast(alternating);
  assertEquals(altAst.parts.length, 40); // 20 literals + 20 expressions

  // Test 3: All operators in sequence
  const allOps = "/base{/path}{+reserved}{#fragment}{?query}{&more}";
  const allOpsAst = parseTemplateFast(allOps);
  assertEquals(allOpsAst.parts.length, 6); // 1 literal + 5 expressions
});

Deno.test("Parser: Non-Strict Mode Behavior", () => {
  const nonStrict = { strict: false };

  // Test 1: Empty expression handling
  const emptyExpr = parseTemplateFast("{}", nonStrict);
  if (emptyExpr.parts[0]?.kind === "Expr") {
    assertEquals(emptyExpr.parts[0].vars.length, 0);
  }

  // Test 2: Malformed modifiers recovery
  const malformed1 = parseTemplateFast("{var:}", nonStrict);
  if (malformed1.parts[0]?.kind === "Expr") {
    // Should recover and treat as no prefix
    assertEquals(malformed1.parts[0].vars[0].prefixLen, 0);
  }

  // Test 3: Invalid characters might be more lenient
  // Note: Current implementation still enforces character set even in non-strict
  assertThrows(
    () => parseTemplateFast("{var-name}", nonStrict),
    Error,
    "Expected ',' or '}'",
    "Even non-strict mode doesn't allow hyphens",
  );
});

Deno.test("Parser: Error Position Accuracy", () => {
  // Verify that error positions are accurate for debugging
  try {
    parseTemplateFast("/users/{id:abc}/profile");
  } catch (e) {
    const error = e as ParseError;
    assertEquals(error.name, "RFC6570ParseError");
    // The error should occur at position of 'a' in 'abc'
    assertEquals(error.index, 11);
  }

  try {
    parseTemplateFast("{unclosed");
  } catch (e) {
    const error = e as ParseError;
    // Error should be at the end of string
    assertEquals(error.index, 8);
  }
});

Deno.test("Parser: Whitespace Handling", () => {
  // RFC 6570 does not allow whitespace in variable names
  // but allows it in literals

  // Test 1: Whitespace in literals is preserved
  const wsLiteral = parseTemplateFast("  /path  /{id}/  end  ");
  assertEquals(extractLiteral(wsLiteral, 0), "  /path  /");
  assertEquals(extractLiteral(wsLiteral, 2), "/  end  ");

  // Test 2: No whitespace allowed in variable names (space is not a valid varname char)
  // The parser treats space as end of variable name, then expects ',' or '}'
  // but finds space, which makes the next char position have empty variable name
  assertThrows(
    () => parseTemplateFast("{x, y}"),
    Error,
    "Empty variable name",
    "Space after comma creates empty variable name",
  );

  // Space before comma also fails similarly
  assertThrows(
    () => parseTemplateFast("{x ,y}"),
    Error,
    "Expected ',' or '}'",
    "Space before comma is invalid",
  );

  // Valid multi-variable syntax without spaces
  const validMulti = parseTemplateFast("{x,y,z}");
  if (validMulti.parts[0].kind === "Expr") {
    assertEquals(validMulti.parts[0].vars.length, 3);
    assertEquals(extractVarName(validMulti, 0, 0), "x");
    assertEquals(extractVarName(validMulti, 0, 1), "y");
    assertEquals(extractVarName(validMulti, 0, 2), "z");
  }
});

Deno.test("Parser: AST Structure Validation", () => {
  // Comprehensive test of AST structure
  const template = "/users{/id}{?filter*,limit:10}{&page}";
  const ast = parseTemplateFast(template);

  assertEquals(ast.kind, "TemplateAST");
  assertEquals(ast.source, template);
  assertEquals(ast.parts.length, 4);

  // Part 0: Literal "/users"
  const part0 = ast.parts[0];
  assertEquals(part0.kind, "Lit");
  assertEquals(ast.source.slice(part0.start, part0.end), "/users");

  // Part 1: Expression {/id}
  const part1 = ast.parts[1];
  if (part1.kind === "Expr") {
    assertEquals(part1.op, "/");
    assertEquals(part1.vars.length, 1);
    assertEquals(ast.source.slice(part1.start, part1.end), "{/id}");
  }

  // Part 2: Expression {?filter*,limit:10}
  const part2 = ast.parts[2];
  if (part2.kind === "Expr") {
    assertEquals(part2.op, "?");
    assertEquals(part2.vars.length, 2);
    assertEquals(part2.vars[0].explode, true);
    assertEquals(part2.vars[1].prefixLen, 10);
  }

  // Part 3: Expression {&page}
  const part3 = ast.parts[3];
  if (part3.kind === "Expr") {
    assertEquals(part3.op, "&");
    assertEquals(part3.vars.length, 1);
  }
});
