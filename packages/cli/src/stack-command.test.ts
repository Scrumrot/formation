import type { Stack } from "@formation/registry";
import { describe, expect, it } from "vitest";

import { stackToCommand } from "./stack-command.js";

const pilot: Stack = {
  framework: "react",
  stateLibrary: "zustand",
  uiLibrary: "mui",
  uiMajor: 9,
  schemaLibrary: "zod",
  syntax: "ts",
  testRunners: [],
};

describe("stackToCommand", () => {
  it("round-trips a stack into flags the raw CLI accepts", () => {
    const command = stackToCommand("./schemas/user.ts", pilot, "./src/forms");

    expect(command).toContain("--state zustand");
    expect(command).toContain("--schema zod");
    expect(command).toContain("--out ./src/forms");
  });

  it("always spells the UI major out", () => {
    // A saved command must keep meaning the same MUI after the default moves on.
    expect(stackToCommand("./schemas/user.ts", pilot, "./out")).toContain("--ui mui@9");
  });

  it("continues lines with a backslash so the output pastes into a shell", () => {
    const backslash = String.fromCharCode(92);

    expect(stackToCommand("./schemas/user.ts", pilot, "./out")).toContain(
      ` ${backslash}\n  --state`,
    );
  });

  it("omits --tests entirely when no runners were chosen", () => {
    expect(stackToCommand("./schemas/user.ts", pilot, "./out")).not.toContain("--tests");
  });
});
