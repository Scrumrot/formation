import { z } from "zod";

// A Zod-first fixture: the kinds a real signup/profile form mixes, including
// the ones JSON Schema cannot express (a `Date` value, a cross-field
// refinement), so the golden project proves the original schema — not a
// lossy copy of it — is what validates the generated form.
export const profileSchema = z
  .object({
    fullName: z.string().min(2, "Tell us your name"),
    email: z.email("That email does not look right"),
    password: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string(),
    age: z.int().min(18, "You must be 18 or older").optional(),
    rating: z.number().min(0).max(5).nullable(),
    role: z.enum(["admin", "editor", "viewer"]),
    tier: z.literal([1, 2, 3]).optional(),
    birthday: z.date(),
    availableFrom: z.iso.date().optional(),
    newsletter: z.boolean().default(true),
    bio: z
      .string()
      .max(500)
      .describe("A short introduction, shown on your public page.")
      .optional(),
    address: z.object({
      street: z.string().min(1, "Street is required"),
      city: z.string().min(1, "City is required"),
      postalCode: z.string().optional(),
    }),
    tags: z.array(z.string().min(1, "A tag cannot be empty")).max(5),
    contacts: z
      .array(
        z.object({
          name: z.string().min(1, "Name is required"),
          phone: z.string().optional(),
          kind: z.enum(["home", "work"]),
          emails: z.array(z.email()),
        }),
      )
      .min(1, "Add at least one contact"),
    payment: z
      .discriminatedUnion("method", [
        z.object({ method: z.literal("card"), last4: z.string() }),
        z.object({ method: z.literal("bank"), iban: z.string() }),
      ])
      .optional(),
    // A union as a list's row: each row picks its own branch.
    notifications: z.array(
      z.discriminatedUnion("channel", [
        z.object({ channel: z.literal("email"), address: z.email("Enter an email address") }),
        z.object({
          channel: z.literal("sms"),
          number: z.string().min(5, "Enter a phone number"),
          quietHours: z.boolean(),
        }),
      ]),
    ),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
