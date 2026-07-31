import type { Diagnostic } from "@formation/core";

import type {
  FormLibraryId,
  FrameworkId,
  SchemaLibraryId,
  Status,
  TestRunnerId,
  UiLibraryId,
} from "./catalog.js";
import {
  formLibraries,
  formLibraryIds,
  frameworkIds,
  frameworks,
  schemaLibraries,
  schemaLibraryIds,
  testRunnerIds,
  testRunners,
  uiLibraries,
  uiLibraryIds,
} from "./catalog.js";

export type Syntax = "ts" | "js";

export type StackSelection = Readonly<{
  framework: string;
  formLibrary: string;
  uiLibrary: string;
  schemaLibrary: string;
  syntax: string;
  testRunners: readonly string[];
}>;

export type Stack = Readonly<{
  framework: FrameworkId;
  formLibrary: FormLibraryId;
  uiLibrary: UiLibraryId;
  schemaLibrary: SchemaLibraryId;
  syntax: Syntax;
  testRunners: readonly TestRunnerId[];
}>;

/**
 * Callers `switch` on `kind` rather than catching — an unsupported stack is an
 * ordinary answer to "is this combination legal?", not an exception.
 */
export type StackResolution =
  | Readonly<{ kind: "valid"; stack: Stack }>
  | Readonly<{ kind: "invalid"; diagnostics: readonly Diagnostic[] }>;

type Lookup<Id extends string> =
  Readonly<{ kind: "found"; id: Id }> | Readonly<{ kind: "problem"; problem: Diagnostic }>;

const unknownOption = (kind: string, value: string, known: readonly string[]): Diagnostic => ({
  severity: "error",
  code: "stack/unknown-option",
  message: `Unknown ${kind} "${value}". Known: ${known.join(", ")}.`,
});

const notYetImplemented = (kind: string, value: string): Diagnostic => ({
  severity: "error",
  code: "stack/incompatible",
  message: `${kind} "${value}" is on the roadmap but not implemented yet.`,
});

const incompatible = (message: string): Diagnostic => ({
  severity: "error",
  code: "stack/incompatible",
  message,
});

/**
 * Looks a value up in a catalog, distinguishing "no such thing" from "planned".
 * Takes the id list and a status accessor rather than the catalog itself, so
 * `find` narrows to `Id` without an assertion.
 */
const pick = <Id extends string>(
  kind: string,
  value: string,
  ids: readonly Id[],
  statusOf: (id: Id) => Status,
): Lookup<Id> => {
  const match = ids.find((id) => id === value);

  if (match === undefined) return { kind: "problem", problem: unknownOption(kind, value, ids) };
  if (statusOf(match) !== "available") {
    return { kind: "problem", problem: notYetImplemented(kind, value) };
  }
  return { kind: "found", id: match };
};

const problemOf = <Id extends string>(lookup: Lookup<Id>): readonly Diagnostic[] =>
  lookup.kind === "problem" ? [lookup.problem] : [];

export const resolveStack = (selection: StackSelection): StackResolution => {
  const framework = pick(
    "framework",
    selection.framework,
    frameworkIds,
    (id) => frameworks[id].status,
  );
  const formLibrary = pick(
    "form library",
    selection.formLibrary,
    formLibraryIds,
    (id) => formLibraries[id].status,
  );
  const uiLibrary = pick(
    "UI library",
    selection.uiLibrary,
    uiLibraryIds,
    (id) => uiLibraries[id].status,
  );
  const schemaLibrary = pick(
    "schema library",
    selection.schemaLibrary,
    schemaLibraryIds,
    (id) => schemaLibraries[id].status,
  );
  const runners = selection.testRunners.map((runner) =>
    pick("test runner", runner, testRunnerIds, (id) => testRunners[id].status),
  );

  const syntaxProblems: readonly Diagnostic[] =
    selection.syntax === "ts" || selection.syntax === "js"
      ? []
      : [unknownOption("syntax", selection.syntax, ["ts", "js"])];

  const lookupProblems = [
    ...problemOf(framework),
    ...problemOf(formLibrary),
    ...problemOf(uiLibrary),
    ...problemOf(schemaLibrary),
    ...runners.flatMap(problemOf),
  ];

  // Cross-checks only run once every individual option is known — otherwise
  // "vue is not implemented" would be followed by a bogus "shadcn doesn't
  // support vue", which reads like two problems when there is one.
  if (
    lookupProblems.length > 0 ||
    syntaxProblems.length > 0 ||
    framework.kind !== "found" ||
    formLibrary.kind !== "found" ||
    uiLibrary.kind !== "found" ||
    schemaLibrary.kind !== "found"
  ) {
    return { kind: "invalid", diagnostics: [...lookupProblems, ...syntaxProblems] };
  }

  const stack: Stack = {
    framework: framework.id,
    formLibrary: formLibrary.id,
    uiLibrary: uiLibrary.id,
    schemaLibrary: schemaLibrary.id,
    syntax: selection.syntax === "js" ? "js" : "ts",
    testRunners: runners.flatMap((runner) => (runner.kind === "found" ? [runner.id] : [])),
  };

  const crossChecks: readonly Diagnostic[] = [
    ...(formLibraries[stack.formLibrary].frameworks.includes(stack.framework)
      ? []
      : [
          incompatible(
            `Form library "${stack.formLibrary}" does not support ${frameworks[stack.framework].label}.`,
          ),
        ]),
    ...(uiLibraries[stack.uiLibrary].frameworks.includes(stack.framework)
      ? []
      : [
          incompatible(
            `UI library "${stack.uiLibrary}" does not support ${frameworks[stack.framework].label}.`,
          ),
        ]),
  ];

  return crossChecks.length > 0
    ? { kind: "invalid", diagnostics: crossChecks }
    : { kind: "valid", stack };
};

/** Options the wizard should offer, given what has been chosen so far. */
export const compatibleFormLibraries = (framework: FrameworkId): readonly FormLibraryId[] =>
  formLibraryIds.filter(
    (id) =>
      formLibraries[id].status === "available" && formLibraries[id].frameworks.includes(framework),
  );

export const compatibleUiLibraries = (framework: FrameworkId): readonly UiLibraryId[] =>
  uiLibraryIds.filter(
    (id) =>
      uiLibraries[id].status === "available" && uiLibraries[id].frameworks.includes(framework),
  );
