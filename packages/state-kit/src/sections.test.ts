import { describe, expect, it } from "vitest";

import { NUMBER_HELPERS } from "./sections.js";

// The pattern is tested as emitted: what matters is the regex that lands in a
// user's project, and a copy kept here could drift from it.
const emittedSource = /const DECIMAL_TEXT = \/(.+)\/;/.exec(NUMBER_HELPERS)?.[1] ?? "";
const decimalText = RegExp(emittedSource);

describe("the emitted number reader", () => {
  it("is found in the helpers, so the tests below are testing something", () => {
    expect(emittedSource).not.toBe("");
  });

  it.each(["1", "-1.5", "+3e10", "1.5E-3", "1.", ".5", "007"])("reads %s as a number", (text) => {
    expect(decimalText.test(text)).toBe(true);
  });

  // Each of these is something typed on the way to a number, or something
  // Number() would accept that nobody means in a form.
  it.each(["", ".", "-", "1e", "1.2.3", "abc", "0x10", "Infinity", "1 000"])(
    "does not read %j as a number",
    (text) => {
      expect(decimalText.test(text)).toBe(false);
    },
  );

  it("gives up on a long run of digits in linear time", () => {
    // A paste, not an attack: the reader runs on every keystroke of a number
    // control. With the fraction written as \d+\.?\d* this input took seconds
    // (quadratic in its length); the bound is loose so a slow machine passes
    // and only a return of that shape fails.
    const pasted = `${"1".repeat(50_000)}x`;
    const start = performance.now();

    expect(decimalText.test(pasted)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
