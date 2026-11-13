import { ConsentForm, useConsentStore } from "@generated/ConsentForm";
import { NewPetForm, useNewPetStore } from "@generated/NewPetForm";
import { OrderForm, useOrderStore } from "@generated/OrderForm";
import { ProfileForm, useProfileStore } from "@generated/ProfileForm";
import { major as muiMajor } from "@mui/material/version";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The generated forms, rendered and driven the way a person would drive them.
 *
 * Typechecking proves the output compiles; only this proves it *works* — that
 * a keystroke reaches the store, a blank submit is refused, and what reaches
 * `onSubmit` is the schema's parsed data. Every query is by role or label, so
 * these also fail if a control loses its accessible name.
 */

// The stores are module singletons (by design — see the comment in any
// generated store), so each test hands the next one a clean form.
afterEach(() => {
  cleanup();
  useOrderStore.getState().reset();
  useProfileStore.getState().reset();
  useNewPetStore.getState().reset();
  useConsentStore.getState().reset();
});

// Injected per config by vitest.shared.ts.
declare const __MUI_MAJOR__: number;

describe("the test environment", () => {
  it("runs against the MUI major this config claims", () => {
    expect(muiMajor).toBe(__MUI_MAJOR__);
  });
});

const choose = async (user: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) => {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
};

describe("OrderForm (from JSON Schema)", () => {
  it("refuses a blank submit and names every gap", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<OrderForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Required")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(screen.getByText("Enter a date and time")).toBeTruthy();
    expect(screen.getByText("Add at least 1 item")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows no errors before the user has done anything", () => {
    render(<OrderForm onSubmit={vi.fn()} />);

    expect(screen.queryByText("Required")).toBeNull();
    expect(screen.queryByText("Enter a valid email address")).toBeNull();
  });

  it("submits the schema's parsed data", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<OrderForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/Full name/), "Ada Lovelace");
    await user.type(screen.getByLabelText(/Email/), "ada@example.com");
    // jsdom has no date picker to type into; a change event is what a real one fires.
    fireEvent.change(screen.getByLabelText(/Placed At/), {
      target: { value: "2026-03-04T05:06" },
    });
    await user.click(screen.getByRole("button", { name: "Add line" }));
    await user.type(screen.getByLabelText(/SKU/), "ABC-1");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      customer: { name: "Ada Lovelace", email: "ada@example.com" },
      // Seeded from the schema's `default`.
      currency: "USD",
      // Local wall-clock text in, a UTC instant out.
      placedAt: new Date("2026-03-04T05:06").toISOString(),
      deliverBy: null,
      express: false,
      lines: [{ sku: "ABC-1", quantity: 1, giftWrap: false }],
    });
  });

  it("keeps a half-typed decimal on screen while storing the number so far", async () => {
    const user = userEvent.setup();

    render(<OrderForm onSubmit={vi.fn()} />);

    const discount = screen.getByLabelText<HTMLInputElement>(/Discount/);

    await user.type(discount, "12.");
    expect(discount.value).toBe("12.");
    expect(useOrderStore.getState().values.discount).toBe(12);

    await user.type(discount, "5");
    expect(discount.value).toBe("12.5");
    expect(useOrderStore.getState().values.discount).toBe(12.5);

    await user.clear(discount);
    expect(useOrderStore.getState().values.discount).toBeUndefined();
  });

  it("stores a numeric enum as a number, not as the menu's text", async () => {
    const user = userEvent.setup();

    render(<OrderForm onSubmit={vi.fn()} />);
    await choose(user, /Priority/, "Urgent");

    expect(useOrderStore.getState().values.priority).toBe(3);
  });

  it("removes the row that was asked for and keeps the others' values", async () => {
    const user = userEvent.setup();

    render(<OrderForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add line" }));
    await user.click(screen.getByRole("button", { name: "Add line" }));

    const [first, second] = screen.getAllByLabelText<HTMLInputElement>(/SKU/);

    await user.type(first as HTMLInputElement, "AAA");
    await user.type(second as HTMLInputElement, "BBB");
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0] as HTMLElement);

    const remaining = screen.getAllByLabelText<HTMLInputElement>(/SKU/);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.value).toBe("BBB");
    expect(useOrderStore.getState().values.lines).toEqual([
      { sku: "BBB", quantity: 1, giftWrap: false },
    ]);
  });
});

describe("ProfileForm (from a Zod module)", () => {
  it("reports the schema author's own messages", async () => {
    const user = userEvent.setup();

    render(<ProfileForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    // Custom messages do not survive a trip through JSON Schema. Seeing them
    // here means the store validates with the user's Zod schema itself.
    expect(await screen.findByText("Tell us your name")).toBeTruthy();
    expect(screen.getByText("That email does not look right")).toBeTruthy();
    expect(screen.getByText("Add at least one contact")).toBeTruthy();
  });

  it("enforces a cross-field refinement, then submits once it is satisfied", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    // Zod runs an object-level `.refine` only once every field has a valid
    // type, so the form starts from values that are complete except for the
    // mismatch. (`reset(values)` is also how an edit form is seeded.)
    useProfileStore.getState().reset({
      ...useProfileStore.getState().values,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse",
      confirmPassword: "battery-staple",
      role: "editor",
      birthday: new Date(1990, 6, 15),
      address: { street: "1 Analytical Way", city: "London", postalCode: undefined },
      contacts: [{ name: "Charles", phone: undefined, kind: "work", emails: [] }],
    });

    render(<ProfileForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Passwords do not match")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    const confirm = screen.getByLabelText(/Confirm Password/);

    await user.clear(confirm);
    await user.type(confirm, "correct-horse");
    expect(screen.queryByText("Passwords do not match")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      fullName: "Ada Lovelace",
      role: "editor",
      birthday: new Date(1990, 6, 15),
      // `.default(true)` on the schema seeds the switch on.
      newsletter: true,
      contacts: [{ name: "Charles", kind: "work", emails: [] }],
    });
  });

  it("gives a z.date() field a real Date", () => {
    render(<ProfileForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Birthday/), { target: { value: "1990-07-15" } });

    const birthday = useProfileStore.getState().values.birthday;

    expect(birthday).toBeInstanceOf(Date);
    // Local midnight, so the day the user picked is the day that is stored.
    expect(birthday?.getFullYear()).toBe(1990);
    expect(birthday?.getMonth()).toBe(6);
    expect(birthday?.getDate()).toBe(15);
    expect(screen.getByLabelText<HTMLInputElement>(/Birthday/).value).toBe("1990-07-15");
  });

  it("shows a server error at once and releases it when the field is edited", async () => {
    const user = userEvent.setup();

    render(<ProfileForm onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText(/Email/), "taken@example.com");
    useProfileStore.getState().setFieldError("email", "That email is already registered");

    expect(await screen.findByText("That email is already registered")).toBeTruthy();

    await user.type(screen.getByLabelText(/Email/), "x");

    expect(screen.queryByText("That email is already registered")).toBeNull();
  });

  it("binds a list nested inside another list's rows", async () => {
    const user = userEvent.setup();

    render(<ProfileForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add contact" }));
    await user.click(screen.getByRole("button", { name: "Add email" }));
    // The contact's nested email row has no `required` asterisk; the form's own Email does.
    await user.type(screen.getAllByLabelText(/Email/)[1] as HTMLElement, "work@example.com");

    expect(useProfileStore.getState().values.contacts[0]?.emails).toEqual(["work@example.com"]);
  });

  it("clears an optional text field back to undefined, not to an empty string", async () => {
    const user = userEvent.setup();

    render(<ProfileForm onSubmit={vi.fn()} />);

    const bio = screen.getByLabelText(/Bio/);

    await user.type(bio, "hi");
    expect(useProfileStore.getState().values.bio).toBe("hi");

    await user.clear(bio);
    expect(useProfileStore.getState().values.bio).toBeUndefined();
  });

  it("shows a union's fields only for the branch that is chosen", async () => {
    const user = userEvent.setup();

    render(<ProfileForm onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText(/Last4/)).toBeNull();

    await choose(user, /^Payment/, "Card");
    await user.type(screen.getByLabelText(/Last4/), "4242");

    expect(useProfileStore.getState().values.payment).toEqual({ method: "card", last4: "4242" });
    expect(screen.queryByLabelText(/Iban/)).toBeNull();
  });

  it("starts the new branch blank when the choice changes, and can be cleared", async () => {
    const user = userEvent.setup();

    render(<ProfileForm onSubmit={vi.fn()} />);
    await choose(user, /^Payment/, "Card");
    await user.type(screen.getByLabelText(/Last4/), "4242");
    await choose(user, /^Payment/, "Bank");

    // No `last4` riding along: it is not part of a bank payment.
    expect(useProfileStore.getState().values.payment).toEqual({ method: "bank", iban: "" });
    expect(screen.queryByLabelText(/Last4/)).toBeNull();

    // The union is optional in the schema, so "None" has to mean absent.
    await choose(user, /^Payment/, "None");
    expect(useProfileStore.getState().values.payment).toBeUndefined();
  });

  it("lets each row of a list pick its own branch", async () => {
    const user = userEvent.setup();

    render(<ProfileForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add notification" }));
    await user.click(screen.getByRole("button", { name: "Add notification" }));

    const [first, second] = screen.getAllByRole("combobox", { name: /^Notification/ });

    await user.click(first as HTMLElement);
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Sms" }));
    await user.click(second as HTMLElement);
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Email" }));
    await user.type(screen.getByLabelText(/^Number/), "55512");
    await user.type(screen.getByLabelText(/^Address/), "ada@example.com");

    expect(useProfileStore.getState().values.notifications).toEqual([
      { channel: "sms", number: "55512", quietHours: false },
      { channel: "email", address: "ada@example.com" },
    ]);
  });
});

describe("NewPetForm (from an OpenAPI document)", () => {
  it("clears a nullable number to null, the blank the API expects", async () => {
    const user = userEvent.setup();

    render(<NewPetForm onSubmit={vi.fn()} />);

    const weight = screen.getByLabelText(/Weight Kg/);

    await user.type(weight, "4.2");
    expect(useNewPetStore.getState().values.weightKg).toBe(4.2);

    await user.clear(weight);
    expect(useNewPetStore.getState().values.weightKg).toBeNull();
  });

  it("submits a section that came through a $ref", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NewPetForm onSubmit={onSubmit} submitLabel="Register" />);
    // Two "Name" fields: the pet's, then the owner's (inside the Owner section).
    const [petName, ownerName] = screen.getAllByLabelText(/^Name/);

    await user.type(petName as HTMLElement, "Biscuit");
    await user.type(ownerName as HTMLElement, "Sam");
    await choose(user, /Species/, "Dog");
    await choose(user, /Housing/, "Outdoor");
    await user.type(screen.getByLabelText(/Fenced area/), "12.5");
    await user.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      housing: { kind: "outdoor", fencedAreaM2: 12.5 },
      name: "Biscuit",
      species: "dog",
      weightKg: null,
      vaccinated: false,
      owner: { name: "Sam" },
      nicknames: [],
    });
  });

  it("refuses a submit while a required union has no branch chosen", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NewPetForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    // The error sits under the branch picker itself, via its own description id.
    const housing = screen.getByRole("combobox", { name: /Housing/ });
    const helper = document.getElementById(housing.getAttribute("aria-describedby") ?? "");

    await waitFor(() => expect(helper?.textContent).toBe("Select an option"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates inside the chosen branch", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NewPetForm onSubmit={onSubmit} />);
    await choose(user, /Housing/, "Outdoor");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    // `fencedAreaM2` is required only by the outdoor branch.
    expect(await screen.findByText("Enter a number")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ConsentForm (booleans only)", () => {
  it("submits switch state", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ConsentForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("switch", { name: /I accept the terms/ }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ terms: true, marketing: false });
  });
});
