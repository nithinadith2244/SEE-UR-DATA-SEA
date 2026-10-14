// DOM binding for index.html. All dynamic text is inserted with textContent;
// there is no innerHTML anywhere in this project.

import { config } from "./config.js";
import { createProvider } from "./providers/index.js";
import { createRateGate } from "./rate-gate.js";
import { createController } from "./controller.js";
import { toViewModel } from "./view-model.js";

function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function externalLink(href, label) {
  return el("a", {
    text: label,
    attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow external" },
  });
}

function renderCard(card) {
  const head = el("div", { className: "card-head" }, [
    el("h4", { text: card.title, className: "card-title" }),
    el("span", {
      text: card.verifiedLabel,
      className: card.verified ? "badge badge-verified" : "badge badge-unverified",
    }),
  ]);
  const facts = el("dl", { className: "facts" });
  for (const f of card.facts) {
    facts.append(el("div", {}, [el("dt", { text: f.label }), el("dd", { text: f.value })]));
  }
  const article = el("article", { className: "breach-card" }, [head, facts]);
  if (card.description) article.append(el("p", { text: card.description, className: "card-desc" }));
  if (card.exposedData.length) {
    const list = el("ul", { className: "chips", attrs: { "aria-label": "Types of data exposed" } });
    for (const d of card.exposedData) list.append(el("li", { text: d }));
    article.append(list);
  }
  if (card.referenceUrl) {
    article.append(el("p", { className: "card-ref" }, [externalLink(card.referenceUrl, "Read the source report")]));
  }
  return article;
}

function renderResult(result) {
  const vm = toViewModel(result);
  const heading = el("h3", {
    text: vm.headline,
    className: "result-title",
    attrs: { id: "result-heading", tabindex: "-1" },
  });
  const wrap = el("div", { className: `result result-${vm.tone}` }, [
    heading,
    el("p", { text: vm.summary, className: "result-summary" }),
  ]);
  if (vm.retry) wrap.append(el("p", { text: vm.retry, className: "result-retry" }));
  if (vm.cards.length) {
    const cards = el("div", { className: "cards" });
    for (const c of vm.cards) cards.append(renderCard(c));
    wrap.append(cards);
  }
  if (vm.nextSteps.length) {
    wrap.append(el("h4", { text: "What you can do now", className: "sub" }));
    const ul = el("ul", { className: "steps" });
    for (const s of vm.nextSteps) ul.append(el("li", { text: s }));
    wrap.append(ul);
  }
  for (const n of vm.notes) wrap.append(el("p", { text: n, className: "note" }));
  if (vm.source) {
    wrap.append(
      el("p", { className: "source" }, [
        document.createTextNode("Data source: "),
        externalLink(vm.source.url, vm.source.name),
        document.createTextNode(". SEE UR DATA is not affiliated with this source."),
      ]),
    );
  }
  return { wrap, heading };
}

function init() {
  const form = document.getElementById("check-form");
  if (!form) return;
  const input = document.getElementById("email");
  const errorEl = document.getElementById("email-error");
  const submitBtn = document.getElementById("submit");
  const cancelBtn = document.getElementById("cancel");
  const clearBtn = document.getElementById("clear");
  const results = document.getElementById("results");
  const statusEl = document.getElementById("provider-status");

  const provider = createProvider(config);
  const gate = createRateGate({
    windows: [
      { limit: config.clientLimits.perMinute, ms: 60_000 },
      { limit: config.clientLimits.perHour, ms: 3_600_000 },
    ],
  });

  // Provider disclosure, always visible next to the form.
  function renderStatus(status) {
    statusEl.textContent = "";
    if (status && status.state === "not_configured") {
      statusEl.className = "provider-status provider-off";
      statusEl.append(
        el("strong", { text: "Live email breach lookup is not configured yet." }),
        document.createTextNode(" Searches will return no result until the site operator sets it up. "),
        el("a", { text: "Why", attrs: { href: "methodology.html" } }),
        document.createTextNode("."),
      );
    } else if (status && status.state === "ready" && status.mode === "test") {
      statusEl.className = "provider-status provider-off";
      statusEl.append(
        el("strong", { text: "Test mode." }),
        document.createTextNode(" This server only answers for Have I Been Pwned's test addresses on hibp-integration-tests.com, not for real email addresses."),
      );
    } else if (provider.isConfigured && provider.info) {
      statusEl.className = "provider-status provider-on";
      statusEl.append(
        document.createTextNode(`${provider.disclosure ?? `Each check sends the address you enter to ${provider.info.name}.`} `),
        el("a", { text: "How this affects your privacy", attrs: { href: "privacy.html" } }),
        document.createTextNode("."),
      );
    } else {
      statusEl.className = "provider-status provider-off";
      statusEl.append(
        el("strong", { text: "Live breach checking is unavailable." }),
        document.createTextNode(" No eligible breach-data provider is configured, so searches return no result. "),
        el("a", { text: "Why", attrs: { href: "methodology.html" } }),
        document.createTextNode("."),
      );
    }
  }
  renderStatus(null);
  if (typeof provider.status === "function") provider.status().then(renderStatus);

  function setError(message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute("aria-invalid", "true");
    } else {
      errorEl.textContent = "";
      errorEl.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  }

  function renderIdle() {
    results.setAttribute("aria-busy", "false");
    results.replaceChildren(
      el("div", { className: "empty" }, [
        el("h3", { text: "No search yet", className: "result-title" }),
        el("p", {
          text: "Enter an address above. It is used only for the check you request and is not stored by this site.",
        }),
      ]),
    );
  }

  function render(state) {
    submitBtn.removeAttribute("aria-disabled");
    submitBtn.textContent = "Check email";
    cancelBtn.hidden = true;
    switch (state.name) {
      case "idle":
        setError(null);
        renderIdle();
        break;
      case "invalid":
        setError(state.error.message);
        renderIdle();
        input.focus();
        break;
      case "loading":
        setError(null);
        submitBtn.setAttribute("aria-disabled", "true");
        submitBtn.textContent = "Checking";
        cancelBtn.hidden = false;
        results.setAttribute("aria-busy", "true");
        results.replaceChildren(
          el("div", { className: "loading", attrs: { role: "status" } }, [
            el("span", { className: "scan-orbit", attrs: { "aria-hidden": "true" } }, [
              el("span", { className: "scan-core" }),
            ]),
            el("span", { text: "Checking. This usually takes a few seconds." }),
          ]),
        );
        break;
      case "result": {
        setError(null);
        const { wrap, heading } = renderResult(state.result);
        results.setAttribute("aria-busy", "false");
        results.replaceChildren(wrap);
        heading.focus({ preventScroll: false });
        break;
      }
    }
  }

  const controller = createController({ provider, gate, render });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (submitBtn.getAttribute("aria-disabled") === "true") return;
    controller.submit(input.value);
  });
  cancelBtn.addEventListener("click", () => {
    controller.cancel();
    input.focus();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    controller.clear();
    input.focus();
  });
  input.addEventListener("input", () => {
    if (!errorEl.hidden) setError(null);
  });

  renderIdle();
}

init();
