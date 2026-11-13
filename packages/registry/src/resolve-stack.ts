import type { Diagnostic } from "@formation/core";

import type {
  FrameworkId,
  SchemaLibraryId,
  StateLibraryId,
  Status,
  TestRunnerId,
  UiLibraryId,
} from "./catalog.js";
import {
  frameworkIds,
  frameworks,
  schemaLibraries,
  schemaLibraryIds,
  stateLibraries,
  stateLibraryIds,
  testRunnerIds,
  testRunners,
  uiLibraries,
  uiLibraryIds,
} from "./catalog.js";

export type Syntax = "ts" | "js";

export type StackSelection = Readonly<{
  framework: string;
  stateLibrary: string;
  /** A UI library id, optionally pinned to a major: `mui` or `mui@7`. */
  uiLibrary: string;
  schemaLibrary: string;
  syntax: string;
  testRunners: readonly string[];
}>;

export type Stack = Readonly<{
  framework: FrameworkId;
  stateLibrary: StateLibraryId;
  uiLibrary: UiLibraryId;
  /** The major the output targets; absent for a library with nothing to pin. */
  uiMajor?: number;
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

/** Splits `mui@7` into the library id and the pinned major, if any. */
export const uiSelection = (value: string): Readonly<{ id: string; major: string | undefined }> => {
  const at = value.indexOf("@");

  return at === -1
    ? { id: value, major: undefined }
    : { id: value.slice(0, at), major: value.slice(at + 1) };
};

type MajorLookup =
  | Readonly<{ kind: "found"; major: number | undefined }>
  | Readonly<{ kind: "problem"; problem: Diagnostic }>;

/**
 * An unsupported major is refused rather than approximated. Output is verified
 * against each listed major's real type declarations; emitting for an unlisted
 * one would be claiming a check that was never run.
 */
const pickMajor = (id: UiLibraryId, requested: string | undefined): MajorLookup => {
  const library = uiLibraries[id];
  const majors = library.majors;

  if (majors === undefined) {
    return requested === undefined
      ? { kind: "found", major: undefined }
      : {
          kind: "problem",
          problem: incompatible(
            `UI library "${id}" takes no version; write "${id}", not "${id}@${requested}".`,
          ),
        };
  }
  if (requested === undefined) return { kind: "found", major: majors.current };

  const major = majors.supported.find((supported) => String(supported) === requested);

  return major === undefined
    ? {
        kind: "problem",
        problem: incompatible(
          `${library.label} ${requested} is not a supported target. Supported: ${majors.supported
            .map((supported) => `${id}@${supported}`)
            .join(", ")} (bare "${id}" means ${id}@${majors.current}).`,
        ),
      }
    : { kind: "found", major };
};

export const resolveStack = (selection: StackSelection): StackResolution => {
  const ui = uiSelection(selection.uiLibrary);

  const framework = pick(
    "framework",
    selection.framework,
    frameworkIds,
    (id) => frameworks[id].status,
  );
  const stateLibrary = pick(
    "state library",
    selection.stateLibrary,
    stateLibraryIds,
    (id) => stateLibraries[id].status,
  );
  const uiLibrary = pick("UI library", ui.id, uiLibraryIds, (id) => uiLibraries[id].status);
  const schemaLibrary = pick(
    "schema library",
    selection.schemaLibrary,
    schemaLibraryIds,
    (id) => schemaLibraries[id].status,
  );
  const runners = selection.testRunners.map((runner) =>
    pick("test runner", runner, testRunnerIds, (id) => testRunners[id].status),
  );

  // "js" is a real option the flag accepts, but no printer emits it yet. Saying
  // so beats silently writing TypeScript for someone who asked for JavaScript.
  const syntaxProblems: readonly Diagnostic[] =
    selection.syntax === "ts"
      ? []
      : selection.syntax === "js"
        ? [notYetImplemented("syntax", "js")]
        : [unknownOption("syntax", selection.syntax, ["ts", "js"])];

  const majorLookup: MajorLookup =
    uiLibrary.kind === "found"
      ? pickMajor(uiLibrary.id, ui.major)
      : { kind: "found", major: undefined };

  const lookupProblems = [
    ...problemOf(framework),
    ...problemOf(stateLibrary),
    ...problemOf(uiLibrary),
    ...(majorLookup.kind === "problem" ? [majorLookup.problem] : []),
    ...problemOf(schemaLibrary),
    ...runners.flatMap(problemOf),
  ];

  // Cross-checks only run once every individual option is known — otherwise
  // "vue is not implemented" would be followed by a bogus "mui doesn't
  // support vue", which reads like two problems when there is one.
  if (
    lookupProblems.length > 0 ||
    syntaxProblems.length > 0 ||
    framework.kind !== "found" ||
    stateLibrary.kind !== "found" ||
    uiLibrary.kind !== "found" ||
    majorLookup.kind !== "found" ||
    schemaLibrary.kind !== "found"
  ) {
    return { kind: "invalid", diagnostics: [...lookupProblems, ...syntaxProblems] };
  }

  const stack: Stack = {
    framework: framework.id,
    stateLibrary: stateLibrary.id,
    uiLibrary: uiLibrary.id,
    ...(majorLookup.major === undefined ? {} : { uiMajor: majorLookup.major }),
    schemaLibrary: schemaLibrary.id,
    syntax: "ts",
    testRunners: runners.flatMap((runner) => (runner.kind === "found" ? [runner.id] : [])),
  };

  const crossChecks: readonly Diagnostic[] = [
    ...(stateLibraries[stack.stateLibrary].frameworks.includes(stack.framework)
      ? []
      : [
          incompatible(
            `State library "${stack.stateLibrary}" does not support ${frameworks[stack.framework].label}.`,
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
export const compatibleStateLibraries = (framework: FrameworkId): readonly StateLibraryId[] =>
  stateLibraryIds.filter(
    (id) =>
      stateLibraries[id].status === "available" &&
      stateLibraries[id].frameworks.includes(framework),
  );

export const compatibleUiLibraries = (framework: FrameworkId): readonly UiLibraryId[] =>
  uiLibraryIds.filter(
    (id) =>
      uiLibraries[id].status === "available" && uiLibraries[id].frameworks.includes(framework),
  );
