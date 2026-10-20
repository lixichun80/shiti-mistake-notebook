import { createElement, type ReactNode } from "react";
import { parseMath, splitMathText, type MathNode } from "@/lib/math-notation";

function nodeContent(node: MathNode, key: number | string): ReactNode {
  switch (node.kind) {
    case "row": return createElement("mrow", { key }, node.children.map((child, index) => nodeContent(child, index)));
    case "sqrt": return node.degree
      ? createElement("mroot", { key }, nodeContent(node.body, "body"), nodeContent(node.degree, "degree"))
      : createElement("msqrt", { key }, nodeContent(node.body, "body"));
    case "fraction": return createElement("mfrac", { key }, createElement("mrow", null, nodeContent(node.numerator, "num")), createElement("mrow", null, nodeContent(node.denominator, "den")));
    case "sup": return createElement("msup", { key }, nodeContent(node.base, "base"), nodeContent(node.script, "script"));
    case "sub": return createElement("msub", { key }, nodeContent(node.base, "base"), nodeContent(node.script, "script"));
    case "symbol": {
      const tag = /^\d+(?:\.\d+)?$/.test(node.value) ? "mn" : /^[a-zA-Zα-ωΑ-Ωπθ]$/.test(node.value) ? "mi" : "mo";
      return createElement(tag, { key }, node.value);
    }
  }
}

/** React keeps ordinary text escaped; MathML is rendered by the browser. */
export default function MathText({ value }: { value: string }) {
  return <>{splitMathText(value || "").map((part, index) => part.kind === "math"
    ? createElement("math", { className: "textbook-math", key: index, "aria-label": part.value }, nodeContent(parseMath(part.value), 0))
    : <span key={index}>{part.value}</span>)}</>;
}
