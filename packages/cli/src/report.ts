import { isAbsolute, relative } from "node:path";

import type { Diagnostic, DiagnosticSeverity } from "@formation/core";
import pc from "picocolors";

// Side effects live here at the edge; everything upstream returns diagnostics
// as data so it stays testable without capturing stdout.

const paint: Readonly<Record<DiagnosticSeverity, (text: string) => string>> = {
  error: pc.red,
  warning: pc.yellow,
  info: pc.dim,
};

const label: Readonly<Record<DiagnosticSeverity, string>> = {
  error: "error",
  warning: "warn",
  info: "info",
};

// Diagnostics carry absolute paths (the pipeline does not know the working
// directory); shown that way they bury the message under a home-directory
// prefix. Relative to where the command ran is what the user typed.
const shown = (source: string): string =>
  isAbsolute(source) ? relative(process.cwd(), source).split("\\").join("/") : source;

const format = (diagnostic: Diagnostic): string => {
  const where = diagnostic.path === undefined ? "" : pc.dim(` at ${diagnostic.path.join(".")}`);
  const source = diagnostic.source === undefined ? "" : pc.dim(` (${shown(diagnostic.source)})`);
  const tag = paint[diagnostic.severity](label[diagnostic.severity]);

  return `${tag} ${diagnostic.message}${where}${source} ${pc.dim(`[${diagnostic.code}]`)}`;
};

export const printDiagnostics = (diagnostics: readonly Diagnostic[]): void => {
  diagnostics.forEach((diagnostic) => console.error(format(diagnostic)));
};
