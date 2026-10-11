import { MIN_PASSWORD_LENGTH } from "./config.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailError(email) {
  if (!email) return "";
  return EMAIL.test(email) ? "" : "Enter a valid email address";
}

export function passwordError(password) {
  if (!password) return "";
  return password.length >= MIN_PASSWORD_LENGTH
    ? ""
    : `Use at least ${MIN_PASSWORD_LENGTH} characters`;
}
