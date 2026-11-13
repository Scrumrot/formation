import { stateLibraries, stateLibraryIds, uiLibraries, uiLibraryIds } from "@formation/registry";
import { describe, expect, it } from "vitest";

import { stateAdapters, uiAdapters } from "./pipeline.js";

// The registry says what is available; the CLI holds the adapters. Nothing in
// the type system ties the two together (the adapter maps are deliberately
// partial, since planned libraries have none), so this is the tie.
describe("the registry and the adapter maps agree", () => {
  it("has a state adapter for every available state library, and for no planned one", () => {
    const available = stateLibraryIds.filter((id) => stateLibraries[id].status === "available");

    expect(Object.keys(stateAdapters).sort()).toEqual([...available].sort());
  });

  it("has a UI adapter for every available UI library, and for no planned one", () => {
    const available = uiLibraryIds.filter((id) => uiLibraries[id].status === "available");

    expect(Object.keys(uiAdapters).sort()).toEqual([...available].sort());
  });

  it("builds an adapter for every major the registry lists as supported", () => {
    const missing = uiLibraryIds.flatMap((id) =>
      (uiLibraries[id].majors?.supported ?? [])
        .filter((major) => uiAdapters[id]?.(major) === undefined)
        .map((major) => `${id}@${major}`),
    );

    expect(missing).toEqual([]);
  });
});
