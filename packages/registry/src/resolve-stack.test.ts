import { describe, expect, it } from "vitest";

import type { StackSelection } from "./resolve-stack.js";
import { compatibleUiLibraries, resolveStack } from "./resolve-stack.js";

const pilot: StackSelection = {
  framework: "react",
  formLibrary: "formstand",
  uiLibrary: "shadcn",
  schemaLibrary: "zod",
  syntax: "ts",
  testRunners: ["vitest"],
};

describe("resolveStack", () => {
  it("accepts the v0.1 pilot stack", () => {
    const result = resolveStack(pilot);

    expect(result.kind).toBe("valid");
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

  it("reports every bad option at once rather than stopping at the first", () => {
    const result = resolveStack({ ...pilot, framework: "ember", uiLibrary: "bootstrap" });

    expect(result.kind === "invalid" && result.diagnostics).toHaveLength(2);
  });

  it("does not pile a compatibility error on top of an unknown-option error", () => {
    // "vue is planned" is the one real problem here; adding "shadcn does not
    // support vue" would read as two failures when there is one.
    const result = resolveStack({ ...pilot, framework: "vue" });

    expect(result.kind === "invalid" && result.diagnostics).toHaveLength(1);
  });
});

describe("compatibleUiLibraries", () => {
  it("offers only shipped libraries for the framework", () => {
    expect(compatibleUiLibraries("react")).toEqual(["shadcn"]);
    expect(compatibleUiLibraries("vue")).toEqual([]);
  });
});
