import { describe, expect, it } from "vitest";

import { camelCase, labelFromName, pascalCase, singularize } from "./casing.js";
import { pathExpr, ref } from "./component-ir.js";

describe("casing", () => {
  it("splits camelCase, separators and acronyms the same way for labels and identifiers", () => {
    expect(labelFromName("firstName")).toBe("First Name");
    expect(labelFromName("first_name")).toBe("First Name");
    expect(labelFromName("APIKey")).toBe("API Key");
    expect(pascalCase("emergency-contacts")).toBe("EmergencyContacts");
    expect(camelCase("NewPet")).toBe("newPet");
  });

  it("keeps a digit-leading key usable as an identifier", () => {
    expect(pascalCase("2fa")).toBe("_2fa");
  });
});

describe("singularize", () => {
  it("reverses the common plurals", () => {
    expect(singularize("Emergency Contacts")).toBe("Emergency Contact");
    expect(singularize("Categories")).toBe("Category");
    expect(singularize("Addresses")).toBe("Address");
  });

  it("leaves singulars that merely end in s alone", () => {
    // A surviving plural is lost polish; "Statu" in a rendered form is a bug.
    expect(singularize("Status")).toBe("Status");
    expect(singularize("Analysis")).toBe("Analysis");
    expect(singularize("Address")).toBe("Address");
  });
});

describe("pathExpr", () => {
  it("collapses an all-static path to one string literal", () => {
    expect(pathExpr(["address", "street"])).toEqual({ kind: "lit", value: "address.street" });
  });

  it("merges static runs around expressions into a template", () => {
    expect(pathExpr([ref("path"), ref("index"), "address", "street"])).toEqual({
      kind: "template",
      parts: [ref("path"), ".", ref("index"), ".address.street"],
    });
  });
});
