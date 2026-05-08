export const isExpression = <T extends { kind: string }>(
  token: T,
): token is Extract<T, { kind: "expression" }> => token.kind === "expression";
