# LeetCode Tutor — Product Requirements

**Status:** Draft for approval · **Date:** 16 September 2026  
**Audience:** Pritan · **Release:** Personal-use v1  
**Development is not authorised until this scope is approved.**

**Revision:** Topic scoring is retained; the homepage is a study dashboard. These requirements supersede the earlier implementation plan's minimal Today-only homepage and deferred-scoring proposals.

## 1. Purpose

Make LeetCode practice easier to start, organise and sustain. Replace the spreadsheet-led routine with a focused study app while preserving existing history and keeping Hermes as the conversational tutor.

Success means less effort deciding what to practise and recording it—not simply more problems or more statistics.

## 2. Proposed product

A single-user web app running locally on the Mac, opened through a simple launcher. It stores its records in SQLite and works without Hermes running.

- **App:** home dashboard, topic scores and movements, question library, answer entry, timer, attempt history, filters and daily/review scheduling.
- **Hermes:** hints, solution reviews and learning guidance when requested in chat.
- **LeetCode:** original problem statements, running code and judging submissions.
- **Spreadsheet:** migration source, then an archive for LeetCode data. Unrelated system-design tabs remain untouched.

Local use is the proposed default. Access from another device while the Mac is off would require a hosted version and a scope decision before development.

## 3. Main user journey

1. Open the **Dashboard** to see today's plan, current topic scores and recent movements. Start the next problem or resume an unfinished attempt.
2. Open the problem on LeetCode. Solve there and paste the answer into the app, or draft in the app and copy to LeetCode to submit.
3. Finish the attempt with a short report. The app saves the answer, outcome, time and help used.
4. Accept the suggested repeat date, choose another date or turn off the repeat.
5. Optionally ask Hermes to review the saved attempt or continue to another problem.

A meaningful attempt counts as practice even when it is not solved. It does not count as a completed problem.

## 4. Required v1 features

| Feature                   | Requirement                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Home dashboard**        | Display today's plan and completion state, current topic scores, topics needing work and recent score movements. Keep Start/Resume prominent, with optional continuation and swap/snooze actions.      |
| **Topic scoring**         | Retain the existing 1–5 topic scale, decimal scores and evidence-based rating approach. Show the current score, latest change and last review date; link changes to supporting attempts and rationale. |
| **Question library**      | Search questions and browse completed, attempted or all questions. Add a question by URL with editable metadata.                                                                                       |
| **Custom tags**           | Create, rename, assign and archive pattern tags. A question can have multiple tags.                                                                                                                    |
| **Tag difficulty**        | Optional 1–10 difficulty for each question–tag pairing. The same tag can have different difficulty on different questions. Keep this separate from LeetCode difficulty and learner proficiency.        |
| **Filtering and sorting** | Filter by tags, selected-tag difficulty, completion status, solve-time bucket, list membership and LeetCode difficulty. Sort by time, recency, review date or selected-tag difficulty.                 |
| **Popular lists**         | Support verified NeetCode 150, NeetCode 250, Blind 75 and custom list memberships without duplicating overlapping questions.                                                                           |
| **Answer entry**          | Python-first code editor, language selection, notes and optional submission links. Autosave drafts and retain previous attempts/answers.                                                               |
| **Attempt logging**       | Record solved/not solved/stopped, help used and active time. Allow unknown values rather than inventing evidence. Confidence and detailed testing fields are optional for ordinary practice.           |
| **Repeat scheduling**     | Recommend a next review from actual outcomes/help; allow manual dates, snooze and no scheduled review. Honour manual choices.                                                                          |
| **Daily refresh**         | Generate a stable recommendation for each local study day. Preserve active work across refreshes and midnight.                                                                                         |
| **Basic topic insight**   | From a topic score, open its practice history, relevant questions and comparable solve times. Distinguish assisted solves and exact repeats from independent unfamiliar attempts.                      |
| **Data ownership**        | Import existing records, export data and answers, and provide a tested backup/restore path.                                                                                                            |

**Time buckets:** 0–<10, 10–<20, 20–<30, 30–<45 and 45+ minutes, plus Unknown. By default, the library uses the latest accepted attempt's active time and displays whether help was used. Acceptance is user-reported unless independently verified; historical checklist completion is labelled separately.

### Homepage layout

- **Today's plan — primary panel:** planned problems, completed/in-progress status, suggested work windows and a clear Start/Resume button. Optional work is marked separately.
- **Topic scores — overview:** existing topic names and scores out of 5, latest movement and last review date. Allow sorting by lowest score or recent change. Highlight areas needing work without hiding the broader picture.
- **Recent movements — activity feed:** topic, previous → new score, date, short reason and a link to the supporting attempt. Show increases and decreases; an unchanged score is not a decline.
- **Recent practice — compact list:** latest attempts, outcomes and links to answers/feedback, so effort remains visible even when a score does not change.

Keep administration and detailed analytics off the homepage. Clicking a topic opens its detail view. The separate attempt workspace hides topic-score panels and revealing history during mixed assessment; the dashboard must not disclose the hidden pattern of an upcoming question.

### Topic-scoring rules

- Preserve the current system rather than introducing a new mastery formula: 1 = unfamiliar, 2 = needs substantial support, 3 = solves standard forms, 4 = handles unseen variants under pressure, 5 = reliable mock performance. Retain existing decimal granularity.
- Hermes records an evidence-based scoring decision during an attempt review, including explicit no-change decisions. Store old/new values, rationale, supporting attempt, effective date and recorded time. Retried writes must not apply the same movement twice.
- Preserve the existing distinction between retention, near-transfer, unseen and mock evidence. Exact-repeat successes alone do not justify new scores above 3; scores of 4–5 need unseen/mixed or mock support.
- Import existing scores unchanged. Label legacy/provisional evidence where applicable rather than silently resetting or treating old ratings as newly validated.
- Scores do not increase automatically from completion counts or fast memorised answers, and do not decrease merely because a day was missed. Insufficient evidence means no justified movement, not an invented score.
- App-only logging does not invoke Hermes. Show that an attempt is awaiting tutor review, retain the last reviewed score and display its date. The scheduler can use stored topic scores alongside due work and coverage.
- Learner topic scores (1–5) are distinct from a question's tag difficulty (1–10). A new custom tag does not automatically acquire a proficiency score without a defined scoring category and evidence.

## 5. Practice and scheduling rules

**Proposed adoption default, pending approval:** one primary attempt and one optional continuation, with a remembered 40-minute budget adjustable to 20 or 60 minutes. This replaces the current four-problem default for an initial two-week trial.

- Balance repair, delayed review and unfamiliar problems across completed study sessions.
- Missed days change priority; they do not create compulsory catch-up work.
- Repeating a memorised solution is retention evidence, not proof of independent problem-solving ability.
- Hide pattern tags, previous solutions and revealing recommendation notes during mixed assessment.
- Tagging and extensive reports must not be prerequisites for saving an ordinary attempt.
- Daily selection uses application rules; it does not require an LLM call or notification service.

## 6. Hermes integration

Hermes uses a small app-owned **MCP server** to access specific application functions, such as getting today's plan/topic scores, retrieving an attempt, searching questions and saving a review, scoring decision or follow-up date. The backend commits a review's score decision and movement record consistently, then the dashboard reads the saved result.

- Hermes is the MCP client; the server is an adapter to the app's backend, not another AI.
- Normal app interactions use the backend directly and do not involve MCP.
- Tutoring stays in Hermes chat for v1. A handoff identifies the saved attempt so its code/report need not be pasted again.
- The user chooses the model in Hermes. The app does not require a separate AI model or provider account.
- App and Hermes update the same attempt record, with duplicate-write protection and verified saves.
- Existing consent-based hint rules remain. The backend enforces permitted operations; Hermes receives no unrestricted SQL tool.
- On a requested review, retrieved code/context may be sent to the model provider configured in Hermes.

## 7. Migration and reliability

Import the relevant question inventory, attempts, notes, list memberships, review intentions, current topic scores and available rating-change evidence from the current Sheet. Preserve source records and flag ambiguous data, including inconsistent time formats. Historical movements may be reconstructed only where old/new values and their supporting source are explicit; do not invent missing intermediate scores or dates. Do not manufacture missing attempts, timings or code.

The Sheet remains authoritative during development. Switch to the app only after the import report is reviewed and approved. Afterwards, do not maintain two writable copies of LeetCode history.

Drafts must survive restart. Failed saves must be visible. Backups must restore questions, answers, relationships, review dates, topic scores and score decisions/movements. The local service must not be exposed publicly without authentication and an explicitly approved deployment change.

## 8. Out of scope for v1

- Running/judging arbitrary code inside the app.
- Automatic LeetCode submission scraping or a browser extension.
- Embedded AI chat or a button that automatically launches a Hermes agent run.
- Multi-user accounts, social features or leaderboards.
- Cross-device offline synchronisation, native desktop packaging or a hosted service.
- A replacement scoring algorithm, complex predictive analytics or automatic daily notifications. The existing topic scores and their movement history are explicitly in scope.

## 9. Sign-off criteria

V1 is ready when:

- A real practice attempt can be started, saved and reopened with its answer intact.
- The homepage displays today's plan, current topic scores and recent movements, with clear links to supporting attempts.
- Existing scores match the approved import; new changes and no-change decisions retain their rationale without duplicate movements or fabricated history.
- Every requested tag, time and list filter returns the correct records.
- Manual review choices survive refresh; returning after missed days offers manageable work.
- Hermes can review an existing attempt and save feedback without duplicate logging.
- Imported records reconcile with the approved source snapshot; unknown data remains explicit.
- Backup restoration works, and routine practice requires no spreadsheet maintenance.

During the adoption trial, check that the Dashboard makes both the next action and areas needing work obvious, and ordinary closeout takes comfortably under a minute. If not, simplify the layout before adding features.

## 10. Decisions for approval

- [x] Retain the existing topic scoring system and use a dashboard homepage with today's plan, topic scores and recent movements — requested by Pritan.
- [ ] Local Mac application is sufficient for v1.
- [ ] Approve the one-primary-attempt adoption trial and shorter ordinary reporting.
- [ ] Keep tutoring in Hermes chat; use LeetCode for execution/submission.
- [ ] Approve this v1 scope, with migration/cutover approval handled separately after verification.
