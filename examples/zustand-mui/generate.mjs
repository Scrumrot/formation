// Regenerates every golden form with the CLI as built, for each supported MUI
// major. The output under src/generated is committed: a diff there after a
// generator change is that change's effect on real output, reviewable as code.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../packages/cli/dist/bin.js", import.meta.url));

const forms = [
  ["schemas/profile.ts"],
  ["schemas/order.json"],
  ["schemas/petstore.yaml", "--select", "NewPet"],
  ["schemas/consent.json"],
];

const majors = [9, 7];

majors.forEach((major) =>
  forms.forEach((args) =>
    execFileSync(
      process.execPath,
      [
        cli,
        "generate",
        ...args,
        "--state",
        "zustand",
        "--ui",
        `mui@${major}`,
        "--out",
        `src/generated/mui${major}`,
        // The goldens are regenerated wholesale; nobody hand-edits them.
        "--force",
      ],
      { stdio: "inherit" },
    ),
  ),
);
