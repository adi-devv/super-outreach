# Outreach profile

Copy this file to `profile.md` in the same folder and replace every `{{PLACEHOLDER}}`.
The skill reads only this file for facts about you. Anything not written here, it won't claim.

---

## Storage
- **DATA_FILE:** `{{ABSOLUTE_PATH_TO_YOUR_outreach_dedupe.md}}` (local dedupe list; copy `templates/outreach_data.md` there)
- **Gmail account for drafts:** {{YOUR_GMAIL_ADDRESS}}
- **Resume file name in Drive (used by the Apps Script only):** {{Your_Resume.pdf}} (must match `RESUME_NAME` in the Apps Script)

---

## 1. Who I am (facts to use, nothing more)
- **Name:** {{FULL_NAME}}
- **Education:** {{DEGREE, MAJOR, SCHOOL, GRAD YEAR}}
- **Current:** {{TITLE}} at **{{COMPANY}}** ({{one line on what you build}}), since {{MONTH YEAR}}
- **Proof points** (numbers beat adjectives; 3–5 bullets):
  - {{e.g. Rebuilt X pipeline: **N× faster**, **M% cheaper**}}
  - {{e.g. Raised Y metric from **A to B**}}
  - {{e.g. Built integrations across Z}}
- **Before:** {{1–3 earlier projects/jobs with one line each}}
- **Contact:** {{EMAIL}} · {{PHONE (optional)}} · {{LINKEDIN_URL}} · {{GITHUB_URL}}
- **Honesty rules:** {{e.g. "My current title is intern. Never call me a full-time engineer."}}

---

## 2. Default targeting (used when no focus is given)

**Hard filters (all must pass):**
1. **Job type:** {{full-time only}}
2. **Role type:** {{e.g. AI/ML, backend, full-stack, SDE, founding engineer}}
3. **Experience:** role asks for {{0–3}} years. Skip senior/staff/principal/lead.
4. **Pay:** above {{PAY_BAR}}, or the company is well funded if pay isn't posted.
5. **Location:** {{CITIES}} or Remote ({{COUNTRY}}).

**Skip:** {{e.g. large companies, services/consulting firms, staffing firms, crypto, ...}}

**Best-fit fields, in priority order:**
1. {{field closest to your strongest proof point}}
2. {{...}}
3. {{...}}

**Role keywords for job searches:** {{e.g. "AI engineer", "backend engineer", "founding engineer"}}
**Wellfound / YC city slugs:** {{e.g. bangalore, mumbai, remote}}

---

## 3. Cold email template

**Subject:** `[Open role] at [Company]: {{your one-line hook}}`
- No specific role: `Engineering at [Company]: {{your one-line hook}}`
- {{Optional: swap words in the hook per company type, e.g. "agent evals" for eval companies}}

**Body:**

> Hi [FirstName],
>
> Hope you're doing well.
>
> I'm {{NAME}}, {{one line on who you are and what you build}}. [One company-specific line tying their product to that work.]
>
> At {{COMPANY}}:
> • {{proof point 1}}
> • {{proof point 2}}
> • {{proof point 3}}
>
> Before that: {{earlier work in one line}}.
>
> I'd love to be considered for the [Role] role, full-time. Happy to do a 15-minute chat. Resume attached.
>
> Best regards,
> {{NAME}}
> {{PHONE (optional)}}
> [LinkedIn]({{LINKEDIN_URL}}) | [GitHub]({{GITHUB_URL}})

**Extra body rules (optional):**
- {{e.g. "For voice AI companies, expand project X: ..."}}
- No specific role: close with "I'd love to be considered for a full-time engineering role at [Company]."

---

## 4. Follow-up template (reply in the original thread, keep its subject)

> Hi [Name],
>
> [One line recalling the last contact.]
>
> Since then I've been {{what you've been doing}}:
> • [2–3 most relevant proof points]
>
> Is there a full-time opening at [Company] I could be considered for? Resume attached.
>
> [Signature]
