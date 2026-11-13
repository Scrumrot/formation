import { describe, expect, it } from "vitest";

import type { StackSelection } from "./resolve-stack.js";
import {
  compatibleStateLibraries,
  compatibleUiLibraries,
  resolveStack,
  uiSelection,
} from "./resolve-stack.js";

const pilot: StackSelection = {
  framework: "react",
  stateLibrary: "zustand",
  uiLibrary: "mui",
  schemaLibrary: "zod",
  syntax: "ts",
  testRunners: [],
};

describe("resolveStack", () => {
  it("accepts the pilot stack and pins bare mui to the current major", () => {
    const result = resolveStack(pilot);

    expect(result.kind === "valid" && result.stack.uiMajor).toBe(9);
  });

  it("accepts every schema input the pilot ingests", () => {
    const kinds = ["zod", "json-schema", "openapi"].map(
      (schemaLibrary) => resolveStack({ ...pilot, schemaLibrary }).kind,
    );

    expect(kinds).toEqual(["valid", "valid", "valid"]);
  });

  it("honors an explicit supported major", () => {
    const result = resolveStack({ ...pilot, uiLibrary: "mui@7" });

    expect(result.kind === "valid" && result.stack.uiMajor).toBe(7);
  });

  it("refuses a major the output is not verified against, naming the ones that are", () => {
    // 8 never existed and 6 is unverified; both must fail rather than be
    // rounded to a neighbour.
    const messages = ["mui@8", "mui@6"].map((uiLibrary) => {
      const result = resolveStack({ ...pilot, uiLibrary });

      return result.kind === "invalid" ? result.diagnostics[0]?.message : "valid";
    });

    expect(messages[0]).toMatch(/MUI 8 is not a supported target\. Supported: mui@7, mui@9/);
    expect(messages[1]).toMatch(/MUI 6 is not a supported target/);
  });

  it("distinguishes a planned option from an unknown one", () => {
    const planned = resolveStack({ ...pilot, framework: "vue" });
    const unknown = resolveStack({ ...pilot, framework: "ember" });

    expect(planned.kind === "invalid" && planned.diagnostics[0]?.message).toMatch(
      /roadmap but not implemented/,
    );
    expect(unknown.kind === "invalid" && unknown.diagnostics[0]?.message).toMatch(
      /Unknown framework/,
    );
  });

  it("says a planned state library is planned rather than unknown", () => {
    const result = resolveStack({ ...pilot, stateLibrary: "formstand" });

    expect(result.kind === "invalid" && result.diagnostics[0]?.message).toMatch(
      /state library "formstand" is on the roadmap/,
    );
  });

  it("refuses JavaScript output instead of silently writing TypeScript", () => {
    const result = resolveStack({ ...pilot, syntax: "js" });

    expect(result.kind === "invalid" && result.diagnostics[0]?.message).toMatch(/not implemented/);
  });

  it("refuses a test runner until one actually emits specs", () => {
    expect(resolveStack({ ...pilot, testRunners: ["vitest"] }).kind).toBe("invalid");
  });

  it("reports every bad option at once rather than stopping at the first", () => {
    const result = resolveStack({ ...pilot, framework: "ember", uiLibrary: "bootstrap" });

    expect(result.kind === "invalid" && result.diagnostics).toHaveLength(2);
  });

  it("does not pile a compatibility error on top of an unknown-option error", () => {
    // "vue is planned" is the one real problem here; adding "mui does not
    // support vue" would read as two failures when there is one.
    const result = resolveStack({ ...pilot, framework: "vue" });

    expect(result.kind === "invalid" && result.diagnostics).toHaveLength(1);
  });
});

describe("uiSelection", () => {
  it("splits an id from its pinned major", () => {
    expect(uiSelection("mui@7")).toEqual({ id: "mui", major: "7" });
    expect(uiSelection("mui")).toEqual({ id: "mui", major: undefined });
  });
});

describe("what the wizard offers", () => {
  it("lists only shipped libraries for the framework", () => {
    expect(compatibleStateLibraries("react")).toEqual(["zustand"]);
    expect(compatibleUiLibraries("react")).toEqual(["mui"]);
    expect(compatibleUiLibraries("vue")).toEqual([]);
  });
});
