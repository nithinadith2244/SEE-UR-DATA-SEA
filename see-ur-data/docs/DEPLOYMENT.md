# Deployment guide: GitHub + Cloudflare Pages

This guide takes you from the unzipped project to a live HTTPS site. **Nothing here has been run on your behalf.** The site is not deployed until you complete these steps and tick the verification checklist at the end.

You will need free accounts at [GitHub](https://github.com) and [Cloudflare](https://dash.cloudflare.com), plus [Git](https://git-scm.com) and [Node.js](https://nodejs.org) 20 or newer on your computer.

---

## Step 0. Before you publish anything

1. **Run the tests locally** (see the README). Do not publish with failing tests.
2. **Edit `js/config.js`:**
   - `contactEmail`: a real address you read. Leave it `""` if you prefer not to publish one.
   - `repositoryUrl`: your GitHub repository's `https://` address once it exists (you can come back and fill this in after Step 2).
   - Leave `provider: "xposedornot-auto"` (free, no key). Run `npm run verify:free-api` first and keep the output.
3. **Review `privacy.html`.** It describes what the software does. As the operator you must add who you are and anything your local law requires.
4. **Understand what becomes public.** Because `index.html` sits at the repository root, Cloudflare Pages publishes the **whole repository**: `tests/`, `docs/`, `scripts/` and `package.json` as well. That is acceptable here because the project contains **no secrets, keys or personal data**, and you must keep it that way. Never commit `.env` files or credentials.

---

## Step 1. Put the project in a Git repository

From inside the project folder:

```bash
git init
git add .
git status          # read the list: nothing secret should appear
git commit -m "Initial commit: SEE UR DATA"
git branch -M main
```

## Step 2. Publish to GitHub

1. On GitHub choose **New repository**. Name it (for example `see-ur-data`), set it to **Public**, and do **not** tick "Add a README" (you already have one).
2. Copy the repository address GitHub shows, then run:

```bash
git remote add origin https://github.com/<your-username>/see-ur-data.git
git push -u origin main
```

3. Open the repository page and confirm the files are there. Then edit `repositoryUrl` in `js/config.js` if you left it blank, commit and push again.

> Tip: if you use the GitHub CLI, `gh repo create see-ur-data --public --source=. --push` does steps 1 and 2 in one command.

## Step 3. Create the Cloudflare Pages project

1. In the Cloudflare dashboard open **Workers & Pages** and choose **Create application**, then the **Pages** option, then **Import an existing Git repository**.
2. Authorise Cloudflare to read your GitHub account and pick the repository.
3. Use these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | leave blank, or enter `exit 0` (Cloudflare's own static-HTML guide uses `exit 0`) |
| Build output directory | `/` (the repository root, where `index.html` lives) |
| Root directory | leave blank |
| Environment variables | none at first. Add the HIBP secret in Step 3b, never anything else secret. |

4. Choose **Save and Deploy**. When the build finishes Cloudflare shows a `https://<project>.pages.dev` address.

**If the dashboard will not accept `/` as the output directory** or the deployed site is blank, use Direct Upload from your computer instead:

```bash
npx wrangler login
npx wrangler pages deploy . --project-name see-ur-data --branch main
```

Cloudflare's guidance is that the output directory must be the folder that directly contains `index.html`; "no files uploaded" or a blank site almost always means the wrong directory.

HTTPS is on by default for `*.pages.dev` and for custom domains attached in the Pages project.

## Step 3b. API routes, and the optional HIBP key

The default free provider needs **no secret**. The `functions/` folder is picked up automatically by Cloudflare Pages and serves `/api/xon` (the relay fallback) with no configuration. Add a Cloudflare **rate-limiting rule** for `/api/xon`, since the in-code limiter is per instance. Everything below this paragraph applies only if you switch to the paid `hibp-server` provider.

The `functions/` folder is picked up automatically by Cloudflare Pages and serves `POST /api/check` and `GET /api/status` using the same code as the Node server.

1. Run `npm run test:integration` on a machine that can reach HIBP. Continue only on exit code 0. (Exit 2 means HIBP was unreachable and proved nothing.)
2. In the Pages project open **Settings, Variables and Secrets**, add **HIBP_API_KEY** for **Production** and choose type **Secret** (encrypted). Paste your paid key. Never put it in the repository, `js/config.js` or a `_headers` file.
3. Do **not** add `HIBP_MODE` in production. Redeploy so the secret is picked up.
4. Add a Cloudflare **rate-limiting rule** for `/api/check` (the in-code limiter is per instance, best effort).
5. Until the secret exists, the site correctly answers "Live email breach lookup is not configured yet." That is a safe state, not an error.

Check `https://YOUR-SITE/api/status` afterwards: `{"state":"ready","mode":"production"}` (and never the key).

## Step 4. Security headers

The file `_headers` in the repository root is read by Cloudflare Pages and applies the Content-Security-Policy, HSTS and other headers to every page. You do not need to configure anything in the dashboard. You **do** need to verify it worked (checklist below), because a headers file that is misplaced or mis-formatted fails silently.

## Step 5. Optional: custom domain

In the Pages project choose **Custom domains** and follow the prompts. Re-run the verification checklist on the new domain. If you later enable HSTS preloading or `includeSubDomains` behaviour for a domain you also use for other services, think through the consequences first. `_headers` ships `includeSubDomains`; remove it if other subdomains of yours are not HTTPS-only.

---

## Verification checklist (do all of it on the deployed URL)

Replace `https://YOUR-SITE` with your address.

### A. The site is up and served securely

- [ ] `https://YOUR-SITE/` loads the home page, with a padlock.
- [ ] `http://YOUR-SITE/` redirects to `https://` (or fails to connect). It must never show content over plain HTTP.
- [ ] All five pages load: `index.html`, `methodology.html`, `limitations.html`, `privacy.html`, `contact.html`. Navigation between them works.
- [ ] `https://YOUR-SITE/does-not-exist` shows a not-found response and not the home page with a 200 (not critical, but know what it does).

### B. Headers are really applied

```bash
curl -sI https://YOUR-SITE/ | grep -iE "content-security-policy|strict-transport|x-content-type|referrer-policy|x-frame|permissions-policy|cross-origin"
```

- [ ] All of these appear: `content-security-policy`, `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `x-frame-options: DENY`, `permissions-policy`.
- [ ] The CSP contains `connect-src 'self'` (and, only if you enabled a provider, exactly that provider's origin).
- [ ] Optional second opinion: scan the URL with a public header checker such as securityheaders.com. It sees only the public URL.

### C. Browser behaviour

Open the site, then dev tools (F12):

- [ ] **Console:** no errors and no "Refused to ..." CSP violations.
- [ ] **Network:** reload. Every request goes to your own domain. No third-party hosts.
- [ ] **Application:** no cookies, local storage, session storage or IndexedDB.
- [ ] Submit `synthetic.user@example.com` (default config): the page says live checking is unavailable and **no request carrying the address** appears in the Network tab.
- [ ] Submit `not-an-email`: a clear error appears and focus returns to the field.
- [ ] Tab from a fresh load: the skip link appears first.

### D. Mobile

- [ ] Open the site on a real phone (or device mode at 375 px). No sideways scrolling; buttons are comfortable to tap; text is readable without zooming.

### E. Content you are responsible for

- [ ] `contact.html` shows a working contact method, not the "not configured" message.
- [ ] `privacy.html` has been reviewed and completed for you as the operator.
- [ ] No page claims worldwide coverage or says an address is "safe".

### F. Free default provider

- [ ] Search an address you own that you know is in a public breach: breach cards appear with "Data source: XposedOrNot".
- [ ] Search a brand-new address you own: "No match found" (with its caveat) or "Unavailable", never a breach card.
- [ ] Network tab on search: either a `GET` to `api.xposedornot.com` (direct route works) or a `POST /api/xon` on your own domain (relay fallback). Note which one; it tells you whether visitors use their own allowance or a shared one.
- [ ] Search 26 times in an hour from one network (or just read the first 429 you hit): you see the rate-limit message with a retry hint, not "no match".
- [ ] Offline: "could not be reached", never "no match".

### F2. Only if you switched to the paid HIBP route

- [ ] `https://YOUR-SITE/api/status` returns `{"state":"ready","mode":"production"}`. If it says `"mode":"test"`, `HIBP_MODE` is set by mistake: remove it.
- [ ] Search an address you own that you know is in a documented breach: breach cards appear with "Data source: Have I Been Pwned".
- [ ] Search an address you own that you believe has never been used: you get "No match found" (with its caveat) or an "Unavailable" message, never a breach card.
- [ ] Network tab: the only request made on search is `POST /api/check` to your own domain. No request goes to haveibeenpwned.com from the browser, and no response or page contains your key.
- [ ] Search `account-exists@hibp-integration-tests.com`: it must be **refused** ("reserved for test mode").
- [ ] Turn off your network in dev tools and search: "could not be reached", never "no match".
- [ ] A test of your Cloudflare rate-limiting rule: repeated rapid searches eventually return a rate-limit message.
- [ ] The Privacy page reflects reality.

### G. Record what you actually verified

Write down the date, the URL, and which boxes you ticked. **Do not state publicly that the site is deployed or verified until A to E are ticked.**

---

## Updating the site later

Edit, run `npm test`, then `git add`, `git commit`, `git push`. Cloudflare rebuilds automatically from `main`, and every pull request can get a preview deployment. Re-run section B after any change to `_headers`.

## Rolling back

In the Pages project open **Deployments**, find an earlier good deployment and choose **Rollback to this deployment**. Also `git revert` the bad commit so the next push does not reintroduce it.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Blank page or "no files uploaded" | Wrong build output directory. It must be the folder that directly contains `index.html`. Use Direct Upload as shown above if needed. |
| Page loads but is unstyled, buttons do nothing | A CSP violation or a wrong path. Open the console. All assets must be same-origin. |
| Headers missing from `curl -I` | `_headers` is not in the deployed root, has the wrong format (each rule's header lines must be indented) or you are viewing a cached response. Redeploy and retry. |
| "Live email breach lookup is not configured yet." | `HIBP_API_KEY` is missing, not 32 hex characters, or is the documented test key. Set the secret and redeploy. |
| "The lookup service rejected this site's credentials" | HIBP returned 401: the key is wrong or revoked. |
| "The lookup service denied access" | HIBP returned 403: the key's plan does not cover this, or the user agent was blocked. |
| "Could not be reached" on every search | `/api/check` is not deployed (static-only hosting without `functions/`), or HIBP is unreachable. |
| Contact page says "not configured" | Fill in `contactEmail` or `repositoryUrl` in `js/config.js`, commit and push. |
