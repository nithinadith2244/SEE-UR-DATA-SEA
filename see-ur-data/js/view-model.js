// Turns a genuine result into plain display data. No DOM, no HTML strings: the
// renderer inserts every value with textContent, so provider text can never be
// interpreted as markup.
//
// Wording rules (enforced by tests/copy.test.js):
//  - a "no match" is never described as safe, secure, clean-for-good or all clear;
//  - "unavailable" never implies either outcome;
//  - nothing is shown that is not in the result object.

import { RESULT_KIND, UNAVAILABLE_REASON as R } from "./result-model.js";

const RISK_LABEL = Object.freeze({
  plaintext: "Passwords stored as readable text",
  easy_to_crack: "Passwords protected by weak hashing",
  hard_to_crack: "Passwords protected by stronger hashing",
  unknown: "Password protection not stated",
});

function plural(n, one, many) {
  return n === 1 ? one : many;
}

export function formatRetry(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 90) return `Try again in about ${seconds} ${plural(seconds, "second", "seconds")}.`;
  const minutes = Math.ceil(seconds / 60);
  return `Try again in about ${minutes} ${plural(minutes, "minute", "minutes")}.`;
}

function cardFor(b) {
  const facts = [];
  if (b.year) facts.push({ label: "Year of breach", value: b.year });
  if (b.domain) facts.push({ label: "Service", value: b.domain });
  if (b.industry) facts.push({ label: "Industry", value: b.industry });
  if (b.records) facts.push({ label: "Records exposed", value: b.records.toLocaleString("en-US") });
  if (b.category) facts.push({ label: "Type", value: CATEGORY_LABEL[b.category] });
  if (b.passwordRisk !== "unknown") facts.push({ label: "Password handling", value: RISK_LABEL[b.passwordRisk] });
  return {
    title: b.name,
    verified: b.verified,
    verifiedLabel: b.verified ? "Verified by the source" : "Not verified by the source",
    facts,
    exposedData: [...b.exposedData],
    description: b.description,
    referenceUrl: b.referenceUrl,
  };
}

const CATEGORY_LABEL = Object.freeze({
  fabricated: "Fabricated: the data was likely manufactured, though the addresses are real",
  spam_list: "Spam list: not a security compromise",
  stealer_log: "Infostealer malware logs",
  malware: "Data collected by malware",
});

const UNAVAILABLE_COPY = Object.freeze({
  [R.SERVER_NOT_CONFIGURED]: {
    headline: "Live email breach lookup is not configured yet.",
    summary:
      "The server behind this site has no breach-lookup key set up, so it cannot say anything about this address. No lookup was made and no result was made up.",
  },
  [R.AUTHENTICATION_ERROR]: {
    headline: "The lookup service rejected this site's credentials",
    summary:
      "The breach-data provider refused the request as unauthenticated. This is a configuration problem on the site's side and there is no result for this address.",
  },
  [R.ACCESS_DENIED]: {
    headline: "The lookup service denied access",
    summary:
      "The breach-data provider refused this request as forbidden. This is a problem on the site's side and there is no result for this address.",
  },
  [R.BAD_REQUEST]: {
    headline: "The lookup request was not accepted",
    summary: "The request could not be processed, so there is no result for this address.",
  },
  [R.SERVER_ERROR]: {
    headline: "The lookup service had a server error",
    summary: "The breach-data provider or this site's server failed while answering. There is no result for this address. Try again later.",
  },
  [R.PROVIDER_UNCONFIGURED]: {
    headline: "Live breach checking is not available yet",
    summary:
      "This site has no eligible breach-data provider configured, so it cannot tell you anything about this address. Nothing was sent anywhere and no result was made up.",
  },
  [R.NETWORK_ERROR]: {
    headline: "The breach-data provider could not be reached",
    summary:
      "The request failed before an answer came back. This says nothing about whether the address appears in a breach. Check your connection and try again.",
  },
  [R.TIMEOUT]: {
    headline: "The breach-data provider took too long to answer",
    summary: "No answer arrived in time, so there is no result for this address.",
  },
  [R.RATE_LIMITED]: {
    headline: "The breach-data provider is limiting requests",
    summary: "The provider asked us to slow down, so there is no result for this address yet.",
  },
  [R.CLIENT_RATE_LIMITED]: {
    headline: "You are checking too quickly",
    summary: "This page limits how fast it sends requests, to protect your allowance with the provider.",
  },
  [R.INVALID_RESPONSE]: {
    headline: "The provider's answer could not be verified",
    summary:
      "The response did not match the format this site accepts, so it was discarded rather than guessed at. There is no result for this address.",
  },
  [R.UNSUPPORTED_RESPONSE]: {
    headline: "The provider's answer is outside what this site can interpret",
    summary:
      "The provider returned information this site does not model, so it will not call the address either listed or unlisted.",
  },
  [R.PROVIDER_ERROR]: {
    headline: "The breach-data provider returned an error",
    summary: "The provider did not return a usable answer, so there is no result for this address.",
  },
  [R.UNVERIFIED_MATCH]: {
    headline: "Possible match, not verified by the source",
    summary:
      "The provider lists this address in the records below, but none of them is marked as verified by the source. Treat this as inconclusive.",
  },
});

/**
 * @param {object} result  a genuine result from result-model.js
 * @returns {{tone:"breach"|"clear"|"unavailable", headline:string, summary:string, nextSteps:string[], notes:string[], source:{name:string,url:string}|null, cards:object[], retry:string|null}}
 */
function baseViewModel(result) {
  switch (result.kind) {
    case RESULT_KIND.CONFIRMED_BREACH: {
      const n = result.breaches.length;
      const verified = result.breaches.filter((b) => b.verified).length;
      const notes = [
        `Details below are reported by ${result.provider.name} and are shown as received. SEE UR DATA has not independently verified them.`,
      ];
      if (verified < n) {
        notes.push(`${verified} of ${n} records are marked verified by the source; the others are shown but not confirmed.`);
      }
      return {
        tone: "breach",
        headline: `Listed in ${n} documented ${plural(n, "breach", "breaches")}`,
        summary: `${result.provider.name} has a record of this address in the ${plural(n, "breach", "breaches")} below.`,
        nextSteps: [
          "Change the password on each affected service.",
          "Use a different password for every account, ideally from a password manager.",
          "Turn on two-step verification wherever it is offered.",
          "Be cautious with unexpected emails or messages that mention these services.",
        ],
        notes,
        source: { name: result.provider.name, url: result.provider.url },
        cards: result.breaches.map(cardFor),
        retry: null,
      };
    }
    case RESULT_KIND.NO_MATCH:
      return {
        tone: "clear",
        headline: "0 known breaches found",
        summary: "No matching breach records were found for this email address in the checked source.",
        nextSteps: [],
        notes: [
          "This does not mean the address has never been exposed. A breach can be unreported, not yet indexed, or outside this provider's coverage.",
          "Keep using a unique password for each account and two-step verification regardless of this result.",
        ],
        source: { name: result.provider.name, url: result.provider.url },
        cards: [],
        retry: null,
      };
    case RESULT_KIND.UNAVAILABLE: {
      const copy = UNAVAILABLE_COPY[result.reason];
      return {
        tone: "unavailable",
        headline: copy.headline,
        summary: copy.summary,
        nextSteps: [],
        notes: ["This is not a result: it does not mean the address is, or is not, in a breach."],
        source: result.provider ? { name: result.provider.name, url: result.provider.url } : null,
        cards: result.breaches ? result.breaches.map(cardFor) : [],
        retry: formatRetry(result.retryAfterSeconds),
      };
    }
    default:
      throw new TypeError("unknown result kind");
  }
}

const TEST_NOTE =
  "TEST MODE: this is the Have I Been Pwned test account. It is synthetic data that says nothing about any real email address.";

export function toViewModel(result) {
  const vm = baseViewModel(result);
  if (result.testMode !== true) return vm;
  return { ...vm, headline: `Test mode: ${vm.headline}`, notes: [TEST_NOTE, ...vm.notes] };
}
