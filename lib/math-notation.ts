/** Small shared notation parser for textbook-style maths in the UI and Word exports. */
export type MathNode =
  | { kind: "row"; children: MathNode[] }
  | { kind: "symbol"; value: string }
  | { kind: "sqrt"; body: MathNode; degree?: MathNode }
  | { kind: "fraction"; numerator: MathNode; denominator: MathNode }
  | { kind: "sup" | "sub"; base: MathNode; script: MathNode };

export type MathSegment = { kind: "text" | "math"; value: string };

const commands: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥",
  neq: "≠", pi: "π", theta: "θ", alpha: "α", beta: "β", infty: "∞",
};

function balancedEnd(input: string, start: number, open: string, close: string): number {
  if (input[start] !== open) return -1;
  let depth = 0;
  for (let i = start; i < input.length; i++) {
    if (input[i] === open) depth++;
    else if (input[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

function commandEnd(input: string, start: number): number {
  const command = ["\\dfrac", "\\tfrac", "\\frac", "\\sqrt"].find(item => input.startsWith(item, start)) || "";
  if (!command) return -1;
  let cursor = start + command.length;
  if (input[cursor] === "[") {
    cursor = balancedEnd(input, cursor, "[", "]");
    if (cursor < 0) return -1;
  }
  const groups = command.endsWith("frac") ? 2 : 1;
  for (let i = 0; i < groups; i++) {
    while (input[cursor] === " ") cursor++;
    cursor = balancedEnd(input, cursor, "{", "}");
    if (cursor < 0) return -1;
  }
  return cursor;
}

/** Recognize explicit TeX, legacy radical glyphs and isolated numeric fractions. */
export function splitMathText(input: string): MathSegment[] {
  const parts: MathSegment[] = [];
  let plain = "";
  const flush = () => { if (plain) { parts.push({ kind: "text", value: plain }); plain = ""; } };
  for (let i = 0; i < input.length;) {
    let end = -1;
    let value = "";
    const delimiter = input.startsWith("\\(", i) ? ["\\(", "\\)"]
      : input.startsWith("\\[", i) ? ["\\[", "\\]"]
      : input.startsWith("$$", i) ? ["$$", "$$"]
      : input[i] === "$" ? ["$", "$"] : null;
    if (delimiter) {
      const close = input.indexOf(delimiter[1], i + delimiter[0].length);
      if (close > i + delimiter[0].length) {
        end = close + delimiter[1].length;
        value = input.slice(i + delimiter[0].length, close);
      }
    }
    if (end < 0 && input[i] === "\\") {
      end = commandEnd(input, i);
      if (end > i) value = input.slice(i, end);
    }
    if (end < 0 && input.startsWith("sqrt(", i) && (i === 0 || !/[\w]/.test(input[i - 1]))) {
      end = balancedEnd(input, i + 4, "(", ")");
      if (end > i) value = input.slice(i, end);
    }
    if (end < 0 && input[i] === "√") {
      const next = i + 1;
      end = input[next] === "(" ? balancedEnd(input, next, "(", ")")
        : input[next] === "{" ? balancedEnd(input, next, "{", "}")
        : next + (input.slice(next).match(/^[\w.]+/)?.[0].length || 0);
      if (end > next) value = input.slice(i, end);
    }
    if (end < 0 && (i === 0 || !/[\w/]/.test(input[i - 1]))) {
      const match = input.slice(i).match(/^-?\d+(?:\.\d+)?\s*\/\s*-?\d+(?:\.\d+)?/);
      if (match && !/[\w/]/.test(input[i + match[0].length] || "")) {
        end = i + match[0].length;
        value = match[0];
      }
    }
    if (end > i) { flush(); parts.push({ kind: "math", value }); i = end; }
    else { plain += input[i]; i++; }
  }
  flush();
  return parts;
}

export function parseMath(input: string): MathNode {
  // The slash shorthand is recognized only when it is the whole segment.
  const simpleFraction = input.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (simpleFraction) return { kind: "fraction", numerator: { kind: "symbol", value: simpleFraction[1] }, denominator: { kind: "symbol", value: simpleFraction[2] } };
  let cursor = 0;
  const group = (): MathNode => {
    while (input[cursor] === " ") cursor++;
    if (input[cursor] === "{") { cursor++; const body = sequence("}"); if (input[cursor] === "}") cursor++; return body; }
    return atom();
  };
  const atom = (): MathNode => {
    if (input[cursor] === "\\") {
      const name = input.slice(cursor + 1).match(/^[A-Za-z]+/)?.[0];
      if (name) {
        cursor += name.length + 1;
        if (["frac", "dfrac", "tfrac"].includes(name)) return { kind: "fraction", numerator: group(), denominator: group() };
        if (name === "sqrt") {
          let degree: MathNode | undefined;
          if (input[cursor] === "[") {
            const end = balancedEnd(input, cursor, "[", "]");
            if (end > 0) { degree = parseMath(input.slice(cursor + 1, end - 1)); cursor = end; }
          }
          return { kind: "sqrt", body: group(), degree };
        }
        if (name === "left" || name === "right") return atom();
        return { kind: "symbol", value: commands[name] || `\\${name}` };
      }
      cursor++;
      return { kind: "symbol", value: input[cursor++] || "\\" };
    }
    if (input[cursor] === "√") {
      cursor++;
      if (input[cursor] === "(") { cursor++; const body = sequence(")"); if (input[cursor] === ")") cursor++; return { kind: "sqrt", body }; }
      return { kind: "sqrt", body: group() };
    }
    if (input.startsWith("sqrt(", cursor)) {
      cursor += 5;
      const body = sequence(")");
      if (input[cursor] === ")") cursor++;
      return { kind: "sqrt", body };
    }
    if (input[cursor] === "{") return group();
    const number = input.slice(cursor).match(/^\d+(?:\.\d+)?/);
    if (number) { cursor += number[0].length; return { kind: "symbol", value: number[0] }; }
    return { kind: "symbol", value: input[cursor++] || "" };
  };
  const sequence = (until = ""): MathNode => {
    const children: MathNode[] = [];
    while (cursor < input.length && (!until || input[cursor] !== until)) {
      if (/\s/.test(input[cursor])) { cursor++; continue; }
      let node = atom();
      while (input[cursor] === "^" || input[cursor] === "_") {
        const kind = input[cursor++] === "^" ? "sup" : "sub";
        node = { kind, base: node, script: group() };
      }
      children.push(node);
    }
    return children.length === 1 ? children[0] : { kind: "row", children };
  };
  return sequence();
}
