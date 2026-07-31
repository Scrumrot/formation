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

const format = (diagnostic: Diagnostic): string => {
  const where = diagnostic.path === undefined ? "" : pc.dim(` at ${diagnostic.path.join(".")}`);
  const source = diagnostic.source === undefined ? "" : pc.dim(` (${diagnostic.source})`);
  const tag = paint[diagnostic.severity](label[diagnostic.severity]);

  return `${tag} ${diagnostic.message}${where}${source} ${pc.dim(`[${diagnostic.code}]`)}`;
};

export const printDiagnostics = (diagnostics: readonly Diagnostic[]): void => {
  diagnostics.forEach((diagnostic) => console.error(format(diagnostic)));
};
