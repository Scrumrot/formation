/**
 * Ingest is lossy by nature — JSON Schema drops custom messages, Yup has no
 * schema export at all, OpenAPI has vendor extensions nobody agrees on. The
 * pipeline therefore never throws on "we couldn't represent that"; it returns
 * the loss as data so the CLI can print it and the user can decide.
 *
 * Throwing is reserved for operator error at a process boundary: unreadable
 * config file, output directory that refuses to be written.
 */

/** Codes are a closed union so they stay greppable and can't drift into prose. */
export type DiagnosticCode =
  // Ingest
  | "schema/unreadable"
  | "schema/unsupported-node"
  | "schema/message-lost"
  | "schema/ref-unresolved"
  | "schema/dialect-approximated"
  // Stack selection
  | "stack/unknown-option"
  | "stack/incompatible"
  // Emit
  | "emit/capability-unsupported"
  | "emit/placeholder-required";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type Diagnostic = Readonly<{
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  /** Field path this concerns, when it concerns one field rather than the document. */
  path?: readonly string[];
  /** Source file the diagnostic originated from, for multi-schema (bulk) runs. */
  source?: string;
}>;

/**
 * A pipeline stage's outcome. `ok` still carries diagnostics — the common case
 * is "we generated the form, and here are the four things we approximated",
 * which is a success that the user must still see.
 */
export type Outcome<T> =
  | Readonly<{ kind: "ok"; value: T; diagnostics: readonly Diagnostic[] }>
  | Readonly<{ kind: "failed"; diagnostics: readonly Diagnostic[] }>;

export const ok = <T>(value: T, diagnostics: readonly Diagnostic[] = []): Outcome<T> => ({
  kind: "ok",
  value,
  diagnostics,
});

export const failed = <T>(diagnostics: readonly Diagnostic[]): Outcome<T> => ({
  kind: "failed",
  diagnostics,
});

export const hasErrors = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error");
