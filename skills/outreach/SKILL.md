---
name: outreach
description: "Cold-email job outreach: /outreach N [focus] finds N new hiring companies that fit your profile, dedupes them against everyone you've contacted, and creates personalized Gmail drafts in batches of 10."
---

# /outreach — job outreach run

Usage: `/outreach N [focus text]`
- `N` = number of NEW companies to find this run (default 30 if no number).
- Anything after the number is the **focus**. Examples: `/outreach 50 frontier AI labs and big tech`, `/outreach 20 voice AI startups in Bengaluru`.

Works from desktop, phone, or a scheduled task. Don't ask for permission between steps. Work through the whole run, then report.

## 0. Read the profile first

Everything personal lives in **`profile.md`** next to this file (copied from `profile.example.md` and filled in by the user). It holds:
- who the user is (background, current role, proof points, contact, honesty rules)
- default targeting (roles, experience, pay bar, locations, skips, best-fit fields)
- the email and follow-up templates, subject line and signature
- where the outreach log lives (Google Drive folder ID)

Read it in full before doing anything else. If `profile.md` is missing or still has `{{PLACEHOLDER}}` values, stop and tell the user which fields to fill in. Never invent facts about the user; use only what the profile says.

## 1. How the focus works
- **Focus given:** the focus decides WHO to target and overrides any conflicting default-targeting rule in the profile (company size, sector, location, pay bar, startup preference).
- **No focus:** use the profile's default targeting.
- The focus never overrides: full-time only (unless the profile says otherwise), dedupe, the profile's honesty rules, the email format, and logging.

## 2. Data lives in Google Drive (single source of truth)
Needs the Google Drive connector, plus either the Gmail connector or the `multi-gmail` MCP (see section 11).
- Folder: the `DRIVE_FOLDER_ID` from the profile.
- `outreach_data.md` — the master dedupe list (every company already contacted or drafted, with email domains, plus bounced / checked-and-skipped lists). Start it from `templates/outreach_data.md` in the repo.
- `outreach_batch_NN_YYYY-MM-DD.md` — one file per batch. The Drive connector can't edit files, so each run adds a new file instead of editing the master.
- **Reading:** `search_files` with `parentId = '<DRIVE_FOLDER_ID>'`, then `download_file_content` for each file. The result is base64 JSON and is often large; decode it with a short script in the shell and grep the decoded text. (`read_file_content` doesn't support markdown files.)
- **Logging:** `create_file` in that folder with `contentMimeType: text/markdown`, `disableConversionToGoogleType: true`, title `outreach_batch_NN_YYYY-MM-DD.md`, where NN is one higher than the highest batch number found.
- This skill + `profile.md` are the ONLY source for email format, subject lines, recipients and rules.

## 3. Sources
1. **LinkedIn Jobs** — only when a browser with the user's sign-in is available (e.g. Claude in Chrome). Search the profile's role keywords in the profile's locations with the **Past week** filter. If no browser, skip it.
2. **Wellfound:** `wellfound.com/role/l/ROLE/CITY` (roles like ai-engineer, software-engineer, backend-engineer, full-stack-engineer, machine-learning-engineer, founding-engineer) and `wellfound.com/location/CITY`. Take each company's `/company/SLUG` URL from the listing page; don't guess slugs (guessed slugs often land on a different company). Company pages give founders, website, size, funding and posting dates.
3. **Y Combinator:** `ycombinator.com/jobs/location/CITY`, `ycombinator.com/jobs/role/software-engineer`, and `ycombinator.com/companies/SLUG` for founders and open jobs. A company page with 0 jobs fails the live-posting filter.
4. **Company job boards** (Greenhouse / Ashby / Lever) found by web search.
5. **Growth / funding signals:** regional funding roundups and startup news for the profile's locations (e.g. weekly funding reports). A funded company still needs a live posting, or log it as an EXCEPTION.

For big-company focuses, use their careers pages and LinkedIn.

## 4. Filters (default targeting)
Apply the hard filters, skips and best-fit ranking from the profile. Generic rules that always apply:
- **Live posting:** posted within the last 30 days, or the company has 2+ open engineering roles. No posting means skip, unless it's an exceptional fit (log it as an EXCEPTION).
- **Experience:** if a company has a senior and a junior opening, pitch the one that matches the profile's experience range.
- **Prefer** highly active, growing or recently funded companies: a round in the last 12 months, many open roles at once, headcount growth, recent accelerator batch or launch. Note the growth signal in the log.

## 5. Dedupe (every company, before adding it)
1. Grep the decoded Drive files (`outreach_data.md` + every `outreach_batch_*.md`) for the company name and email domain, case-insensitive, plus name variants. Watch for substring false matches (e.g. "Cone" inside "Pinecone").
2. Search Gmail Sent for the last 30 days only: `in:sent newer_than:30d COMPANY` and `... DOMAIN`. Also check unsent drafts (`search_mail` with `folder: "drafts"` on every account), because those aren't in Sent yet. Mail older than 30 days that got no reply or bounced is deliberately fair game again (it was pruned from the dedupe list), but skip any company that replied, even long ago. With the `multi-gmail` MCP, run `search_mail` on every account (`list_accounts` first), since the company may have been contacted from another one.
Skip anything already contacted, drafted, bounced, or checked and skipped.

## 6. Finding the person and email
1. **Person:** accelerator company page (founders), Wellfound company page / people, company About page. Prefer the founder/CTO, or the Head of Engineering if named.
2. **Email:** check in order: an address published on the company site (footer, contact page, **privacy policy**, which often names a founder as grievance officer), the job post, a prior reply, then a `firstname@domain` guess. Confirm the **email domain**, which can differ from the website.
3. Guesses bounce often; add variants rather than relying on one, and mark them *unverified* in the log.
4. **No person found:** send to careers@ + hello@ (or hr@) at the domain and greet "Hi [Company] team".

## 7. Writing the email
Use the cold template, subject line rules and body rules from `profile.md`. General rules:
- **To:** the main founder / CTO / engineering lead (greet only them), **plus every other address you found for the same company**: co-founders, senior leaders, HR/TA leads, careers@/hr@ inboxes. For large companies with an unclear email format, add 2–3 format variants of the same person (first.last@, flast@, first@).
- Body is HTML: `<p>` paragraphs, `•` bullets separated by `<br>`, key numbers in `<strong>`, about 110 words.
- Reorder the proof-point bullets so the one closest to the company's product comes first.
- Write a fresh company-specific line every time. Never "I came across X while…".
- Signature links are hyperlinked words only (e.g. `LinkedIn | GitHub`), never raw URLs. No other links in the body.
- Follow-ups reply in the original thread and keep its subject, using the profile's follow-up template.

## 8. The run, step by step
1. Read `profile.md`. Parse `N` and the focus. Load the dedupe data from the Drive folder.
2. Research companies until you have 10 that pass the filters (or the focus) and dedupe.
3. **Every 10 companies:** create the Gmail drafts (HTML, one draft per company, all addresses in To; with the MCP, one `create_drafts` call, which spreads them across accounts), then save the batch to Drive as a new `outreach_batch_NN_YYYY-MM-DD.md` file:
   - Heading: `## Batch NN — COUNT companies, FOCUS-or-default (researched DATE) — DRAFTS CREATED DATE TIME`
   - Table: `| # | Company | What / growth signal | Role (source, posted) | Pay | To |`, marking guessed addresses *unverified* and published ones ✅.
   - One line: "Checked and skipped: COMPANY (reason), …" so later runs don't recheck them.
4. Repeat until N companies are drafted. If sources run dry before N, stop, log what you have, and say so.
5. **Don't send from Claude.** The auto-sender Apps Script (`apps-script/Code.gs`) attaches the resume and sends drafts on a timer (every 6 hours), max 20 per run. Install it separately in every account that holds drafts.
6. Finish with a short summary: companies found, drafts created, batch files saved, how many addresses are guesses, and anything that blocked the run (e.g. no browser, so LinkedIn was skipped).

## 9. Bounces
When asked to check bounces: search Gmail for `from:mailer-daemon newer_than:2d` and save the bounced companies as a new Drive file `outreach_bounces_YYYY-MM-DD.md` in the folder. Don't re-guess bounced addresses; suggest applying via the job post instead.

## 10. Cautions
- **Tense:** follow the profile's status line. If the profile says the role has ended, write it in the past tense ("at Kodo", "I built"), never "currently at". Check every template and every draft before creating it.
- Don't use a current employer's paid tools (Sales Navigator, Apollo, etc.) for your own job search.
- If the profile's proof points come from a current employer, confirm they're OK to share externally before a large batch.
- High bounce rates can get a Gmail account rate-limited. Prefer published addresses, and keep guessed variants to a few per company.

## 11. Multiple Gmail accounts (`multi-gmail` MCP)
Optional. `mcp/multi-gmail/` in this repo is a stdio MCP that works over IMAP with app passwords, so several Gmail accounts can hold drafts. It never sends mail. Setup is in its README; accounts go in the gitignored `accounts.json`.
- `list_accounts`, `verify_account`: check what is configured and that it logs in.
- `create_drafts`: HTML drafts, spread across accounts so none builds too large a pending queue (`maxPendingWeight`). Pass `account` to pin one. Use `dryRun` to see the plan first.
- `search_mail`, `read_thread`: look through Sent or Inbox, e.g. dedupe, bounces (`from:mailer-daemon`), replies.
- `create_reply_drafts`: follow-ups inside the original thread, in the account that sent it.
- `list_drafts`, `count_drafts`, `delete_draft`: manage the queue.

**Follow-ups:** `search_mail` with `{account: "<name>", folder: "sent", hasReply: false, sinceDays: 14}`, `read_thread` on each hit, then `create_reply_drafts` using the profile's follow-up template. Never follow up on a company that replied.

**Bounces:** `search_mail` with `query: "from:mailer-daemon"` on each account, then log them as in section 9.

Without the MCP, use the Gmail connector in the single account named in the profile.
