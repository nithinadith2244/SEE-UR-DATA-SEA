// Client-side email validation and normalisation. Pure functions, no DOM.
// Deliberately conservative: it accepts the common ASCII subset of RFC 5321/5322
// and rejects quoted local parts, comments, IP literals and non-ASCII input.

export const MAX_EMAIL_LENGTH = 254;
export const MAX_LOCAL_LENGTH = 64;

const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD_RE = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

export const EMAIL_ERRORS = Object.freeze({
  empty: "Enter an email address to check.",
  too_long: "That address is longer than the 254 characters email allows.",
  whitespace: "Remove spaces from the address.",
  non_ascii: "Addresses with non-English characters are not supported yet.",
  no_at: "Add an @ sign, for example name@example.com.",
  multiple_at: "Use exactly one @ sign.",
  local_empty: "Add the part before the @ sign.",
  local_too_long: "The part before the @ sign can be at most 64 characters.",
  local_invalid: "The part before the @ sign has a character or dot placement that email does not allow.",
  domain_invalid: "The part after the @ sign must be a domain such as example.com.",
});

function fail(code) {
  return Object.freeze({ ok: false, code, message: EMAIL_ERRORS[code] });
}

/**
 * @param {unknown} input
 * @returns {{ok:true,email:string}|{ok:false,code:string,message:string}}
 */
export function validateEmail(input) {
  if (typeof input !== "string") return fail("empty");
  const value = input.trim();
  if (value === "") return fail("empty");
  if (value.length > MAX_EMAIL_LENGTH) return fail("too_long");
  if (/\s/.test(value)) return fail("whitespace");
  if (/[^\x21-\x7E]/.test(value)) return fail("non_ascii");

  const parts = value.split("@");
  if (parts.length === 1) return fail("no_at");
  if (parts.length > 2) return fail("multiple_at");

  const [local, domain] = parts;
  if (local === "") return fail("local_empty");
  if (local.length > MAX_LOCAL_LENGTH) return fail("local_too_long");
  if (!LOCAL_RE.test(local)) return fail("local_invalid");

  if (domain === "" || domain.length > 253) return fail("domain_invalid");
  const labels = domain.split(".");
  if (labels.length < 2) return fail("domain_invalid");
  if (!labels.every((l) => LABEL_RE.test(l))) return fail("domain_invalid");
  if (!TLD_RE.test(labels[labels.length - 1])) return fail("domain_invalid");

  return Object.freeze({ ok: true, email: value.toLowerCase() });
}
