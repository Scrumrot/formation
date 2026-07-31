import type { Stack } from "@formation/registry";
import { describe, expect, it } from "vitest";

import { stackToCommand } from "./stack-command.js";

const pilot: Stack = {
  framework: "react",
  formLibrary: "formstand",
  uiLibrary: "shadcn",
  schemaLibrary: "zod",
  syntax: "ts",
  testRunners: ["vitest"],
};

describe("stackToCommand", () => {
  it("round-trips a stack into flags the raw CLI accepts", () => {
    const command = stackToCommand("./schemas/user.ts", pilot, "./src/forms");

    expect(command).toContain("--framework react");
    expect(command).toContain("--form formstand");
    expect(command).toContain("--tests vitest");
  });

  it("omits --tests entirely when no runners were chosen", () => {
    const command = stackToCommand("./schemas/user.ts", { ...pilot, testRunners: [] }, "./out");

    expect(command).not.toContain("--tests");
  });
});
