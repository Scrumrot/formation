import { describe, expect, it } from "vitest";

import type { Manifest, PendingFile } from "./write.js";
import { emptyManifest, hashOf, parseManifest, planWrites } from "./write.js";

const file = (key: string, content: string, existing?: string): PendingFile => ({
  key,
  content,
  existing,
});

const wrote = (key: string, content: string): Manifest => ({
  version: 1,
  files: { [key]: hashOf(content) },
});

describe("planWrites", () => {
  it("writes a file that does not exist yet", () => {
    const plan = planWrites([file("a.ts", "new")], emptyManifest, false);

    expect(plan.kind === "ready" && plan.writes.map((entry) => entry.key)).toEqual(["a.ts"]);
  });

  it("regenerates a file nobody has touched since it was written", () => {
    const plan = planWrites([file("a.ts", "new", "old")], wrote("a.ts", "old"), false);

    expect(plan.kind === "ready" && plan.writes.map((entry) => entry.key)).toEqual(["a.ts"]);
  });

  it("refuses to overwrite a file edited after it was written", () => {
    const plan = planWrites([file("a.ts", "new", "old, then edited")], wrote("a.ts", "old"), false);

    expect(plan).toEqual({ kind: "blocked", edited: ["a.ts"] });
  });

  it("refuses to overwrite a file it has no record of writing", () => {
    // A hand-written file that happens to sit at the destination is somebody's
    // work, exactly like an edited one.
    const plan = planWrites([file("a.ts", "new", "hand-written")], emptyManifest, false);

    expect(plan.kind).toBe("blocked");
  });

  it("blocks the whole run when any one file is edited", () => {
    // All-or-nothing: a form with a fresh store and a stale component would
    // not compile.
    const plan = planWrites(
      [file("a.ts", "new", "edited"), file("b.ts", "new")],
      wrote("a.ts", "old"),
      false,
    );

    expect(plan).toEqual({ kind: "blocked", edited: ["a.ts"] });
  });

  it("overwrites an edited file under --force and records the new hash", () => {
    const plan = planWrites([file("a.ts", "new", "edited")], emptyManifest, true);

    expect(plan.kind === "ready" && plan.manifest.files["a.ts"]).toBe(hashOf("new"));
  });

  it("leaves an identical file alone", () => {
    const plan = planWrites([file("a.ts", "same", "same")], emptyManifest, false);

    expect(plan.kind === "ready" && plan.writes).toEqual([]);
    expect(plan.kind === "ready" && plan.unchanged.map((entry) => entry.key)).toEqual(["a.ts"]);
  });

  it("does not mistake a line-ending rewrite for an edit", () => {
    // git's autocrlf changes the bytes on checkout without anyone editing.
    const plan = planWrites(
      [file("a.ts", "three\n", "one\r\ntwo\r\n")],
      wrote("a.ts", "one\ntwo\n"),
      false,
    );

    expect(plan.kind).toBe("ready");
  });
});

describe("parseManifest", () => {
  it("reads a missing or corrupt manifest as no record, rather than throwing", () => {
    expect(parseManifest(undefined)).toEqual(emptyManifest);
    expect(parseManifest("{ not json")).toEqual(emptyManifest);
    expect(parseManifest('{"files": 3}')).toEqual(emptyManifest);
  });

  it("keeps only well-formed entries", () => {
    expect(parseManifest('{"version":1,"files":{"a.ts":"abc","b.ts":7}}').files).toEqual({
      "a.ts": "abc",
    });
  });
});
