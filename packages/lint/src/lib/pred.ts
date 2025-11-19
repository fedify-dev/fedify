import { isNil, isObject } from "@fxts/core";

export function isFederationObject(node: unknown): boolean {
  if (!isObject(node) || isNil(node)) return false;
  const n = node as Record<string, unknown>;

  // createFederation() 또는 createFederationBuilder() 함수 호출 결과인 경우
  if (n.type === "CallExpression") {
    const callee = n.callee as Record<string, unknown>;
    if (callee.type === "Identifier") {
      const name = callee.name as string;
      return /^create(Federation|FederationBuilder)$/i.test(name);
    }
    return false;
  }

  // Identifier인 경우: federation이라는 이름의 변수
  if (n.type === "Identifier") {
    const name = n.name as string;
    // 정확히 'federation'이거나 'Federation'으로 끝나는 변수명만 허용
    return name === "federation" || name.endsWith("Federation");
  }

  // ObjectExpression (객체 리터럴)은 명백히 Federation이 아님
  if (n.type === "ObjectExpression") {
    return false;
  }

  // 그 외의 경우는 검사 대상으로 간주 (보수적 접근)
  return true;
}
