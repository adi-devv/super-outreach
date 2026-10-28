# Multi-account Gmail Drafts MCP

This stdio server reads mail and creates, lists, verifies, and moves Gmail drafts. It only uses IMAP and has no delivery capability: it never sends mail.

1. Enable 2-Step Verification for every Gmail account.
2. Create an app password at `https://myaccount.google.com/apppasswords`.
3. Enable IMAP in each Gmail account's settings. Workspace policy can disable app passwords.
4. Copy `accounts.example.json` to `accounts.json`, add the accounts, and keep it private. Or set `MGMCP_ACCOUNTS` to its absolute path.
5. Install the MCP server with:

```powershell
claude mcp add multi-gmail --scope user -- node "/absolute/path/to/super-outreach/mcp/multi-gmail/src/index.js"
```

Install the Apps Script separately in each account if your workflow needs it; this project does not install or manage Apps Script.

Tools include `search_mail`, `read_thread`, and `create_reply_drafts`, alongside the existing draft-management tools. Reading uses the same app password; it needs no additional permissions.

For a follow-up, call `search_mail` with `{ "account": "all", "folder": "sent", "hasReply": false, "sinceDays": 14 }`, read a result with `read_thread`, then call `create_reply_drafts` with its account and message ID. Reply drafts stay in that original account and carry the conversation headers needed for Gmail threading.

`MGMCP_DRY_RUN=1` also forces `create_reply_drafts` to plan only. It may connect to IMAP read-only to fetch the original and check duplicate drafts, but never appends a draft.

Run offline tests with `npm test`. Test a configured account deliberately with `node scripts/selftest.js`; it creates one temporary draft per account and moves it to Trash. Add `--keep` to pause before removal.
