/**
 * JSON parsing that never rounds a large integer.
 *
 * iLink message ids are 64-bit unsigned integers. `JSON.parse` turns anything above 2^53 into
 * the nearest double, which silently changes the id. Here an integer literal that does not
 * round-trip through a double is kept as its exact decimal string; every other value parses as
 * usual. Callers that need an identifier read it with `identifier()`, which accepts either form.
 */

export class LosslessJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LosslessJsonError";
  }
}

const MAX_DEPTH = 64;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

export type LosslessValue = null | boolean | number | string | LosslessValue[] | { [key: string]: LosslessValue };

class Reader {
  private index = 0;
  constructor(private readonly text: string) {}

  parse(): LosslessValue {
    const value = this.value(0);
    this.skip();
    if (this.index !== this.text.length) this.fail("Unexpected trailing content");
    return value;
  }

  private fail(reason: string): never {
    throw new LosslessJsonError(`Invalid JSON at ${this.index}: ${reason}`);
  }

  private skip(): void {
    while (this.index < this.text.length && WHITESPACE.has(this.text[this.index]!)) this.index++;
  }

  private value(depth: number): LosslessValue {
    if (depth > MAX_DEPTH) this.fail("Nesting is too deep");
    this.skip();
    const char = this.text[this.index];
    if (char === "{") return this.object(depth);
    if (char === "[") return this.array(depth);
    if (char === '"') return this.string();
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) return this.number();
    for (const [word, result] of [["true", true], ["false", false], ["null", null]] as const)
      if (this.text.startsWith(word, this.index)) {
        this.index += word.length;
        return result;
      }
    return this.fail("Unexpected token");
  }

  private number(): number | string {
    NUMBER.lastIndex = this.index;
    const match = NUMBER.exec(this.text);
    if (!match) this.fail("Malformed number");
    const literal = match![0];
    this.index += literal.length;
    const parsed = Number(literal);
    // An integer literal keeps its exact digits unless a double represents it exactly.
    if (/^-?\d+$/.test(literal) && !Number.isSafeInteger(parsed)) return literal;
    return parsed;
  }

  private string(): string {
    let result = "";
    this.index++;
    for (;;) {
      const char = this.text[this.index++];
      if (char === undefined) this.fail("Unterminated string");
      if (char === '"') return result;
      if (char < " ") this.fail("Control character in string");
      if (char !== "\\") {
        result += char;
        continue;
      }
      const escape = this.text[this.index++];
      if (escape === undefined) this.fail("Unterminated escape");
      if (escape === "u") {
        const digits = this.text.slice(this.index, this.index + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail("Malformed unicode escape");
        result += String.fromCharCode(Number.parseInt(digits, 16));
        this.index += 4;
      } else if (escape in ESCAPES) result += ESCAPES[escape];
      else this.fail("Unknown escape");
    }
  }

  private array(depth: number): LosslessValue[] {
    const result: LosslessValue[] = [];
    this.index++;
    this.skip();
    if (this.text[this.index] === "]") {
      this.index++;
      return result;
    }
    for (;;) {
      result.push(this.value(depth + 1));
      this.skip();
      const char = this.text[this.index++];
      if (char === "]") return result;
      if (char !== ",") this.fail("Expected , or ]");
    }
  }

  private object(depth: number): { [key: string]: LosslessValue } {
    // A null prototype keeps a hostile `__proto__` key an ordinary property.
    const result: { [key: string]: LosslessValue } = Object.create(null);
    this.index++;
    this.skip();
    if (this.text[this.index] === "}") {
      this.index++;
      return result;
    }
    for (;;) {
      this.skip();
      if (this.text[this.index] !== '"') this.fail("Expected a property name");
      const key = this.string();
      this.skip();
      if (this.text[this.index++] !== ":") this.fail("Expected :");
      result[key] = this.value(depth + 1);
      this.skip();
      const char = this.text[this.index++];
      if (char === "}") return result;
      if (char !== ",") this.fail("Expected , or }");
    }
  }
}

export const parseLosslessJson = (text: string): LosslessValue => new Reader(text).parse();

/** Reads an identifier that may arrive as a JSON string or integer, as its exact decimal text. */
export const identifier = (value: unknown): string | null => {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
};
