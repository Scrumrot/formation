import { z } from "zod";

// One rule, and it belongs to no single field: the refinement names no `path`,
// so Zod reports it at the root. That is the one kind of error a form shows
// outside any control, and this fixture exists to prove each state library's
// form hook actually surfaces it.
export const bookingSchema = z
  .object({
    from: z.iso.date("Pick a start date"),
    to: z.iso.date("Pick an end date"),
  })
  .refine((booking) => booking.to >= booking.from, "The end date is before the start date");
