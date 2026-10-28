# super-outreach

Automated cold-email job outreach with Claude.

- Type `/outreach 20` and Claude finds 20 companies that are hiring and fit you, skips anyone you've already emailed, and writes a personal Gmail **draft** for each.
- A small Google Apps Script then attaches your resume and sends those drafts every 6 hours (max 20 per run).

Claude never sends anything itself. You can check or delete drafts before they go out.

## Setup (about 10 minutes)

**You need:** a Claude account with the **Gmail** connector turned on (or the `multi-gmail` MCP), and your resume as a PDF in Google Drive for the sender script.

### 1. Make your profile
1. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
2. In `skills/outreach/`, make a copy of `profile.example.md` and name it `profile.md`.
3. Open `profile.md` and replace everything in `{{ }}` with your details: background, results, the jobs you want, your email template.

### 2. Set up your data file
1. Copy `templates/outreach_data.md` somewhere on your machine (not in this repo's tracked files). This is the list of companies you've contacted.
2. Put its path in `profile.md` as `DATA_FILE`.
3. Upload your resume PDF anywhere in Google Drive (the sender script attaches it).

### 3. Add the skill to Claude
1. Zip the `skills/outreach` folder (with your `profile.md` inside).
2. In Claude: **Settings → Capabilities → Skills → Upload skill**, and pick the zip.

*Claude Code users:* copy `skills/outreach` to `~/.claude/skills/outreach` instead.

### 4. Set up the auto-sender
1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Delete what's in `Code.gs` and paste in `apps-script/Code.gs` from this repo.
3. At the top, set `RESUME_NAME` to your resume's exact file name, and `SENDER_NAME` to your name.
4. Press **Save**, pick `installTrigger` in the function menu, and press **Run**. Allow the permissions it asks for.

That's it. It now runs every 6 hours on its own. You can see each run under **Executions** on the left.

## Optional: spread drafts across several Gmail accounts

[`mcp/multi-gmail`](mcp/multi-gmail) is a small MCP server (IMAP + Gmail app passwords, no Google Cloud) that creates drafts evenly across up to ~5 Gmail accounts, can read past mail and create threaded follow-up drafts, and **never sends** (no SMTP, no send tool). Install the Apps Script from `apps-script/` in each account. Setup is in its [README](mcp/multi-gmail/README.md); put your app passwords in a local `accounts.json`, which is gitignored.

## Use it

```
/outreach 20                              20 companies matching your profile
/outreach 30 voice AI startups in Bengaluru   anything after the number sets the focus
```

Ask Claude to **"check bounces"** to log emails that didn't get delivered.

## Good to know

- **Free Gmail allows about 100 recipients a day** from scripts. The sender stops by itself when it hits the limit and continues the next day.
- **It sends every draft in your Gmail.** If you keep other drafts, set `SUBJECT_FILTER` in `Code.gs` to a word that's in all your outreach subjects.
- **Guessed emails bounce.** Too many bounces can get Gmail to limit your sending, so stick to 1–2 guesses per company.
- Test first: set `DRY_RUN = true` in `Code.gs` to attach your resume without sending.

## License

MIT
