/**
 * The single source of truth for what stacks exist. Both CLI surfaces read it:
 * the wizard filters each question's options against it, the raw CLI validates
 * flags against it. That shared dependency is what keeps the two modes from
 * drifting into two products with different ideas of what's supported.
 */

/**
 * `planned` entries are listed on purpose. A user who types `--framework vue`
 * deserves "planned, not yet implemented" rather than "unknown framework" —
 * the first is a roadmap, the second looks like a typo. The wizard hides
 * planned entries; the flag parser names them.
 */
export type Status = "available" | "planned";

// Ids are declared as unions rather than inferred from the objects below with
// `as const`. Inference would type each entry's `frameworks` as a literal tuple
// (`readonly ["react"]`), so `.includes(someFrameworkId)` would not typecheck.
// The duplication is checked in both directions: `Record` demands every id, and
// excess-property checking rejects any that isn't declared.

export type FrameworkId = "react" | "vue" | "svelte" | "solid" | "preact" | "angular" | "lit";

export type FormLibraryId =
  "formstand" | "react-hook-form" | "tanstack-form" | "formik" | "final-form";

export type UiLibraryId = "shadcn" | "mui" | "mantine" | "vuetify";

export type SchemaLibraryId = "zod" | "json-schema" | "typebox" | "valibot" | "arktype" | "yup";

export type TestRunnerId = "vitest" | "jest" | "playwright";

export type Framework = Readonly<{
  label: string;
  status: Status;
  /** Peer range the generated code targets. */
  versions: string;
  /** Extension for generated component files. */
  extension: string;
  /** Which ComponentIR printer serializes for this framework. */
  printer: "jsx" | "vue-sfc" | "svelte" | "angular" | "lit";
  /** Testing Library binding used by the component-spec emitters. */
  testingLibrary: string;
}>;

export type FormLibrary = Readonly<{
  label: string;
  status: Status;
  package: string;
  frameworks: readonly FrameworkId[];
}>;

export type UiLibrary = Readonly<{
  label: string;
  status: Status;
  frameworks: readonly FrameworkId[];
  /**
   * shadcn is copy-in source rather than a dependency, so "generate a form"
   * means something different on a fresh repo (see docs/plan.md §12). The
   * emitter needs to know which model it's dealing with.
   */
  distribution: "dependency" | "copy-in";
}>;

export type SchemaLibrary = Readonly<{
  label: string;
  status: Status;
  package: string;
  /** How ingest reaches FormIR — see docs/plan.md §4. */
  route: "native-json-schema" | "to-json-schema" | "introspection";
}>;

export type TestRunner = Readonly<{
  label: string;
  status: Status;
  /**
   * Component specs render and assert; browser specs navigate and assert. Not
   * the same test emitted twice, which is why `--tests` takes a list.
   */
  style: "component" | "browser";
}>;

export const frameworks: Readonly<Record<FrameworkId, Framework>> = {
  react: {
    label: "React",
    status: "available",
    versions: ">=18",
    extension: "tsx",
    printer: "jsx",
    testingLibrary: "@testing-library/react",
  },
  vue: {
    label: "Vue",
    status: "planned",
    versions: ">=3.4",
    extension: "vue",
    printer: "vue-sfc",
    testingLibrary: "@testing-library/vue",
  },
  svelte: {
    label: "Svelte",
    status: "planned",
    versions: ">=5",
    extension: "svelte",
    printer: "svelte",
    testingLibrary: "@testing-library/svelte",
  },
  solid: {
    label: "Solid",
    status: "planned",
    versions: ">=1.8",
    extension: "tsx",
    printer: "jsx",
    testingLibrary: "@solidjs/testing-library",
  },
  preact: {
    label: "Preact",
    status: "planned",
    versions: ">=10",
    extension: "tsx",
    printer: "jsx",
    testingLibrary: "@testing-library/preact",
  },
  angular: {
    label: "Angular",
    status: "planned",
    versions: ">=17",
    extension: "ts",
    printer: "angular",
    testingLibrary: "@testing-library/angular",
  },
  lit: {
    label: "Lit",
    status: "planned",
    versions: ">=3",
    extension: "ts",
    printer: "lit",
    testingLibrary: "@testing-library/dom",
  },
};

export const formLibraries: Readonly<Record<FormLibraryId, FormLibrary>> = {
  formstand: {
    label: "formstand",
    status: "available",
    package: "formstand",
    frameworks: ["react"],
  },
  "react-hook-form": {
    label: "React Hook Form",
    status: "planned",
    package: "react-hook-form",
    frameworks: ["react"],
  },
  "tanstack-form": {
    label: "TanStack Form",
    status: "planned",
    package: "@tanstack/react-form",
    frameworks: ["react", "vue", "solid", "svelte"],
  },
  formik: {
    label: "Formik",
    status: "planned",
    package: "formik",
    frameworks: ["react"],
  },
  "final-form": {
    label: "React Final Form",
    status: "planned",
    package: "react-final-form",
    frameworks: ["react"],
  },
};

export const uiLibraries: Readonly<Record<UiLibraryId, UiLibrary>> = {
  shadcn: {
    label: "shadcn/ui",
    status: "available",
    frameworks: ["react"],
    distribution: "copy-in",
  },
  mui: { label: "MUI", status: "planned", frameworks: ["react"], distribution: "dependency" },
  mantine: {
    label: "Mantine",
    status: "planned",
    frameworks: ["react"],
    distribution: "dependency",
  },
  vuetify: { label: "Vuetify", status: "planned", frameworks: ["vue"], distribution: "dependency" },
};

export const schemaLibraries: Readonly<Record<SchemaLibraryId, SchemaLibrary>> = {
  zod: { label: "Zod", status: "available", package: "zod", route: "to-json-schema" },
  "json-schema": {
    label: "JSON Schema",
    status: "available",
    package: "",
    route: "native-json-schema",
  },
  typebox: {
    label: "TypeBox",
    status: "planned",
    package: "@sinclair/typebox",
    route: "native-json-schema",
  },
  valibot: { label: "Valibot", status: "planned", package: "valibot", route: "to-json-schema" },
  arktype: { label: "ArkType", status: "planned", package: "arktype", route: "to-json-schema" },
  yup: {
    // No JSON Schema export exists; ingest reads `schema.describe()` directly.
    label: "Yup",
    status: "planned",
    package: "yup",
    route: "introspection",
  },
};

export const testRunners: Readonly<Record<TestRunnerId, TestRunner>> = {
  vitest: { label: "Vitest", status: "available", style: "component" },
  jest: { label: "Jest", status: "planned", style: "component" },
  playwright: { label: "Playwright", status: "planned", style: "browser" },
};

// Typed key lists. `Object.keys` widens to `string[]`, and every consumer needs
// the narrow id type, so the assertion happens once here rather than at each
// call site.
export const frameworkIds = Object.keys(frameworks) as readonly FrameworkId[];
export const formLibraryIds = Object.keys(formLibraries) as readonly FormLibraryId[];
export const uiLibraryIds = Object.keys(uiLibraries) as readonly UiLibraryId[];
export const schemaLibraryIds = Object.keys(schemaLibraries) as readonly SchemaLibraryId[];
export const testRunnerIds = Object.keys(testRunners) as readonly TestRunnerId[];
