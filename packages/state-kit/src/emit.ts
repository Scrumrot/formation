import { isIdentifier, pathPattern } from "@formation/core";

/**
 * Small text builders for a generated state module. Every state adapter prints
 * the same kinds of thing — a titled section, a table keyed by path, a union of
 * string literal types — and printing them one way keeps the modules of two
 * adapters recognisably the same file with a different middle.
 */

export const section = (title: string): string =>
  `\n// ---- ${title} ${"-".repeat(Math.max(4, 72 - title.length))}\n`;

/**
 * Conditional source. Not tidiness: a project with `noUnusedLocals` rejects a
 * helper its form never calls, so each piece of a state module is emitted only
 * when something in the form uses it.
 */
export const when = (condition: boolean, source: string): string => (condition ? source : "");

/** A path's key in a generated table: its pattern, quoted only when it has to be. */
export const tableKey = (path: readonly string[]): string => {
  const pattern = pathPattern(path);

  return isIdentifier(pattern) ? pattern : JSON.stringify(pattern);
};

// Two branches of a union may declare a field of the same name, which puts
// the same path in a table twice. A repeated key is a compile error in an
// object literal, so only the first entry is kept.
export const table = (entries: readonly (readonly [string, string])[]): string => {
  const unique = entries.filter(
    ([name], index) => entries.findIndex(([other]) => other === name) === index,
  );

  return unique.length === 0
    ? "{}"
    : `{\n${unique.map(([name, value]) => `${name}: ${value},`).join("\n")}\n}`;
};

export const union = (types: readonly string[]): string =>
  types.length === 0 ? "never" : [...new Set(types)].map((type) => `| ${type}`).join("\n");
