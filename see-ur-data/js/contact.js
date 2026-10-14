// Renders contact methods from config.js only. Nothing is invented: when the
// operator has not set a real address or repository URL, the page says so.

import { config } from "./config.js";
import { validateEmail } from "./email.js";
import { sanitizeHttpsUrl } from "./url.js";

const target = document.getElementById("contact-methods");
if (target) {
  const items = [];

  const mail = validateEmail(config.contactEmail);
  if (mail.ok) {
    const a = document.createElement("a");
    a.href = `mailto:${mail.email}`;
    a.textContent = mail.email;
    items.push(["Email", a]);
  }

  const repo = sanitizeHttpsUrl(config.repositoryUrl);
  if (repo) {
    const a = document.createElement("a");
    a.href = repo;
    a.rel = "noopener noreferrer";
    a.textContent = "Open an issue on the project repository";
    items.push(["Report a problem", a]);
  }

  target.textContent = "";
  if (items.length === 0) {
    const p = document.createElement("p");
    p.textContent =
      "No contact channel has been configured for this site yet. The site operator needs to set contactEmail or repositoryUrl in js/config.js.";
    target.append(p);
  } else {
    const dl = document.createElement("dl");
    dl.className = "facts";
    for (const [label, node] of items) {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.append(node);
      row.append(dt, dd);
      dl.append(row);
    }
    target.append(dl);
  }
}
