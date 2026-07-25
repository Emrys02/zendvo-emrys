import { z } from "zod";


const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export const phoneField = z
  .string()
  .trim()
  .regex(E164_REGEX, "Must be a valid E.164 phone number (e.g. +14155552671)");

export type PhoneNumber = z.infer<typeof phoneField>;

export const phoneSchema = z.object({ phone: phoneField });
export type PhoneSchema = z.infer<typeof phoneSchema>;

export const signUpSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "At least 2 characters"),
  email: z
    .string()
    .trim()
    .email("Invalid email address"),
  phone: phoneField,
  password: z
    .string()
    .min(8, "At least 8 characters"),
});
export type SignUpSchema = z.infer<typeof signUpSchema>;

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2, "At least 2 characters").optional(),
  phone: phoneField.optional(),
});
export type ProfileUpdateSchema = z.infer<typeof profileUpdateSchema>;

const avatarUrlField = z
  .string()
  .trim()
  .max(2048, "Avatar URL is too long")
  .url("Invalid avatar URL")
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Avatar URL must use HTTP or HTTPS");

export const userProfileUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be at most 100 characters")
      .optional(),
    phoneNumber: phoneField.optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Invalid email address")
      .max(254, "Email address is too long")
      .optional(),
    avatarUrl: avatarUrlField.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field must be provided",
  });

export type UserProfileUpdate = z.infer<typeof userProfileUpdateSchema>;
export const isValidE164 = (value: unknown): value is PhoneNumber =>
  phoneField.safeParse(value).success;
