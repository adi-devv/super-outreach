/**
 * ResumeAttachSend
 *
 * Attaches your resume PDF (from Google Drive) to Gmail drafts and sends them.
 * Meant to run on a time-driven trigger, e.g. every 6 hours.
 *
 * Each run handles drafts one at a time (attach -> send), oldest first, and stops at
 * MAX_PER_RUN sends, when the time budget runs out, or when the daily recipient quota
 * can't cover the next draft. Anything left over goes out on the next run.
 *
 * Setup: see the README in the repo root (step 4).
 */

// ---- Config -------------------------------------------------------------------------
var RESUME_NAME = "Your_Resume.pdf"; // exact file name of the PDF in your Google Drive
var SENDER_NAME = "Your Name";       // display name on outgoing mail
var MAX_PER_RUN = 20;                // max drafts sent per trigger run
var SUBJECT_FILTER = "";             // only send drafts whose subject contains this text ("" = every draft)
var TIME_BUDGET_MS = 5 * 60 * 1000;  // stop before Apps Script's 6-minute execution limit
var DRY_RUN = false;                 // true = attach the resume but don't send (for testing)
// -------------------------------------------------------------------------------------

function attachAndSendDrafts() {
  var start = Date.now();
  var pdf = getResume_();
  if (!pdf) {
    Logger.log("Resume not found in Drive: " + RESUME_NAME);
    return;
  }

  // getDrafts() returns newest first; reverse so the backlog clears oldest first.
  var drafts = GmailApp.getDrafts().reverse();
  var done = 0;

  for (var i = 0; i < drafts.length && done < MAX_PER_RUN; i++) {
    if (Date.now() - start > TIME_BUDGET_MS) {
      Logger.log("Time budget reached, stopping. The rest go out next run.");
      break;
    }

    var draft = drafts[i];
    var msg = draft.getMessage();
    var subj = msg.getSubject() || "";
    if (SUBJECT_FILTER && subj.indexOf(SUBJECT_FILTER) === -1) continue;

    var recipients = countRecipients_(msg);
    if (recipients === 0) {
      Logger.log("No recipients, skipping: " + subj);
      continue;
    }
    if (MailApp.getRemainingDailyQuota() < recipients) {
      Logger.log("Daily recipient quota too low for '" + subj + "' (needs " + recipients + "). Stopping until it resets.");
      break;
    }

    try {
      draft = ensureResume_(draft, msg, pdf);
      if (DRY_RUN) {
        done++;
        Logger.log("Dry run, attached only: " + subj);
        continue;
      }
      draft.send();
      done++;
      Logger.log("Sent (" + done + "/" + MAX_PER_RUN + ") -> " + subj);
      Utilities.sleep(1000);
    } catch (err) {
      Logger.log("Failed '" + subj + "': " + err);
    }
  }

  Logger.log("Done. " + (DRY_RUN ? "Attached: " : "Sent: ") + done +
             " | Drafts left: " + GmailApp.getDrafts().length +
             " | Quota left: " + MailApp.getRemainingDailyQuota());
}

/** Creates the time trigger. Run once by hand from the editor. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "attachAndSendDrafts") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("attachAndSendDrafts").timeBased().everyHours(6).create();
  Logger.log("Trigger installed: attachAndSendDrafts every 6 hours.");
}

function getResume_() {
  var files = DriveApp.getFilesByName(RESUME_NAME);
  return files.hasNext() ? files.next().getBlob() : null;
}

/** Adds the resume to the draft unless it's already attached. Returns the (possibly updated) draft. */
function ensureResume_(draft, msg, pdf) {
  var attachments = msg.getAttachments();
  var has = attachments.some(function (a) { return a.getName() === RESUME_NAME; });
  if (has) return draft;
  return draft.update(msg.getTo(), msg.getSubject() || "", "", {
    htmlBody: msg.getBody(),
    cc: msg.getCc(),
    bcc: msg.getBcc(),
    attachments: attachments.concat([pdf]),
    name: SENDER_NAME
  });
}

function countRecipients_(msg) {
  return [msg.getTo(), msg.getCc(), msg.getBcc()]
    .join(",")
    .split(",")
    .filter(function (s) { return s.trim() !== ""; })
    .length;
}
