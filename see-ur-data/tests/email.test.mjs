import test from "node:test";
import assert from "node:assert/strict";
import { validateEmail } from "../js/email.js";

test("accepts valid synthetic addresses and normalises to lower case", () => {
  const valid = [
    ["user@example.com", "user@example.com"],
    ["  First.Last@Example.COM  ", "first.last@example.com"],
    ["user+tag@sub.example.co.uk", "user+tag@sub.example.co.uk"],
    ["o'brien@example.org", "o'brien@example.org"],
    ["a_b-c@example.io", "a_b-c@example.io"],
    ["x@xn--bcher-kva.example", "x@xn--bcher-kva.example"],
    ["u@a-b.example.net", "u@a-b.example.net"],
  ];
  for (const [input, expected] of valid) {
    const r = validateEmail(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.email, expected);
  }
});

test("rejects invalid input with a specific, user-readable code", () => {
  const invalid = [
    ["", "empty"],
    ["   ", "empty"],
    [undefined, "empty"],
    [null, "empty"],
    [42, "empty"],
    ["plainaddress", "no_at"],
    ["a@@example.com", "multiple_at"],
    ["a@b@example.com", "multiple_at"],
    ["@example.com", "local_empty"],
    [".leading@example.com", "local_invalid"],
    ["trailing.@example.com", "local_invalid"],
    ["double..dot@example.com", "local_invalid"],
    ['"quoted"@example.com', "local_invalid"],
    ["a(b)@example.com", "local_invalid"],
    ["user@", "domain_invalid"],
    ["user@localhost", "domain_invalid"],
    ["user@-bad.example.com", "domain_invalid"],
    ["user@bad-.example.com", "domain_invalid"],
    ["user@example..com", "domain_invalid"],
    ["user@example.c", "domain_invalid"],
    ["user@example.123", "domain_invalid"],
    ["user@[127.0.0.1]", "domain_invalid"],
    ["us er@example.com", "whitespace"],
    ["user@exa\nmple.com", "whitespace"],
    ["usér@example.com", "non_ascii"],
    ["user@exämple.com", "non_ascii"],
    [`${"a".repeat(65)}@example.com`, "local_too_long"],
    [`a@${"b".repeat(250)}.com`, "too_long"],
  ];
  for (const [input, code] of invalid) {
    const r = validateEmail(input);
    assert.equal(r.ok, false, String(input));
    assert.equal(r.code, code, String(input));
    assert.ok(r.message.length > 10);
  }
});

test("hostile input is rejected, never normalised into something valid", () => {
  for (const s of ["<script>alert(1)</script>@example.com", "a@example.com<img src=x>", "a@example.com?x=1&y=2", "a@example.com/path", "a@example.com#frag"]) {
    assert.equal(validateEmail(s).ok, false, s);
  }
});

test("results are frozen", () => {
  assert.throws(() => {
    "use strict";
    validateEmail("user@example.com").email = "x";
  });
});
