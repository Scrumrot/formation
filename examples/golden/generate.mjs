// Regenerates every golden form with the CLI as built, once per target stack.
// The output under src/generated is committed: a diff there after a generator
// change is that change's effect on real output, reviewable as code.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../packages/cli/dist/bin.js", import.meta.url));

const forms = [
  ["schemas/profile.ts"],
  ["schemas/order.json"],
  ["schemas/petstore.yaml", "--select", "NewPet"],
  ["schemas/consent.json"],
];

// Not the full state × UI product, on purpose. The two axes are independent by
// construction (a UI adapter only ever sees the hook contract), so each value
// of each axis needs to appear once, not once per partner: both MUI majors run
// under zustand, and formstand runs under the current MUI.
const targets = [
  { state: "zustand", ui: "mui@9" },
  { state: "zustand", ui: "mui@7" },
  { state: "formstand", ui: "mui@9" },
];

targets.forEach(({ state, ui }) =>
  forms.forEach((args) =>
    execFileSync(
      process.execPath,
      [
        cli,
        "generate",
        ...args,
        "--state",
        state,
        "--ui",
        ui,
        "--out",
        `src/generated/${state}-${ui.replace("@", "")}`,
        // The goldens are regenerated wholesale; nobody hand-edits them.
        "--force",
      ],
      { stdio: "inherit" },
    ),
  ),
);
