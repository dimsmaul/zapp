# Crikket capture and replay PRD

**Status:** Draft · **Date:** 2026-11-25

## Product goal

A reporter can capture a bug from the browser, share a working link quickly, and move on. A teammate can open that link, see what happened, and inspect the technical context without asking the reporter to reproduce it again.

The long-term goal is functional parity with Jam.dev for browser bug reporting. The first release focuses on the quality of the capture, share, and replay journey. Jam’s public product describes browser recording, screenshots, and attached console logs, network requests, user events, and device details. Its documented browser experience also includes recent-screen replay and timestamp links. [Jam product overview](https://jam.dev/) · [Instant replay](https://jam.dev/blog/launching-today-jam-for-incognito-be-20x-faster-at-reporting-bugs-in-incognito/) · [Timestamp links](https://jam.dev/blog/6-new-features-for-even-faster-bug-repros/)

## Users and current problem

- **Reporters** include QA, support, product, and developers. They need to show an issue quickly and retain the capture if submission fails.
- **Investigators** include developers and QA. They need fast playback and enough context to connect a visible symptom to an action, console error, or network request.

Crikket already uploads artifacts directly to object storage. The embedded SDK sends media and debugger artifacts sequentially. The backend then queues debugger ingestion and awaits it inside finalization before it returns the link. The report read policy also gates some viewers on submission readiness. These code paths establish where users can wait. Measure their actual contribution before assigning a latency budget to each stage. [SDK upload transport](https://github.com/dimsmaul/crikket/blob/134f574cef995818c74004275272fc8e3319cc73/sdks/capture/src/transport/default-submit-transport.ts) · [Finalization](https://github.com/dimsmaul/crikket/blob/134f574cef995818c74004275272fc8e3319cc73/packages/bug-reports/src/lib/upload-session.ts) · [Read policy](https://github.com/dimsmaul/crikket/blob/134f574cef995818c74004275272fc8e3319cc73/packages/bug-reports/src/lib/read-access-policy.ts)

## First-release requirements

| Journey step | Acceptance criteria |
| --- | --- |
| Capture and review | The browser extension and embedded widget support screenshots and recordings. After capture ends, the reporter sees a preview or immediate progress feedback. The reporter can review the capture and submit it with the intended visibility. |
| Upload and recover | The reporter sees upload progress and can retry a transient failure from the review screen without recording again while that session remains open. A repeated finalize request resolves to the same report. |
| Copy a working link | The link becomes copyable once the media is verified and the report is durably saved. An authorized recipient can open it while debugger processing is pending or failed. The share page distinguishes those states from successful processing and from captures with no debugger data. |
| Play and investigate | A screenshot is visible or a recording is playable before debugger panels finish loading. Once available, captured actions, console logs, and network requests are navigable in recording order. Selecting a timestamped event seeks the recording to the relevant time. Network bodies load on demand. |
| Preserve access and history | Existing report links, supported SDK and extension clients, public/private visibility, and organization boundaries continue to work during rollout. The same access rules apply to the report, media, and debugger data, including during partial processing. |

## Performance and release criteria

These are proposed launch targets. Establish the current baseline before implementation and run the same scenarios against the candidate release.

| Metric | Proposed target |
| --- | --- |
| Stop recording to visible preview or progress feedback | p95 ≤ 250 ms |
| Last required media upload acknowledged to working, copyable link | p95 ≤ 1 s for the reference workload |
| Cold share-link navigation to first visible frame | p95 ≤ 2 s on the reference network, measured with playback started as soon as the player is available |
| Shareable report to debugger ready | p95 ≤ 10 s for a standard capture with debugger data |
| Successful submission to a playable report | ≥ 99% of eligible attempts during the pilot |

- Use a 30-second 720p recording with a fixed debugger fixture and a screenshot fixture. Run both on supported desktop Chromium with a cold and warm share page. Use 50 Mbps down, 10 Mbps up, 40 ms RTT as the reference profile and 5 Mbps down, 1 Mbps up, 150 ms RTT as a constrained profile.
- Measure stop-to-link and submit-to-link separately. Stop-to-link includes time spent reviewing the capture. Use a fixed review step for comparisons and report upload time by file-size bucket and network profile.
- Count eligible attempts from submit through playable report. Exclude explicit cancellations and permission denials. Count failed uploads, finalize errors, and unplayable media as failures. Report screenshots and recordings separately.
- Run the same browser extension capture, share, and playback tasks in Crikket and Jam where workflows are comparable. Record timing, manual steps, failures, and points where users lose track of progress. Use the results to validate release scope and targets.
- Exercise interrupted uploads, duplicate finalization, delayed or failed debugger processing, and unauthorized links before rollout. Pilot and compare against the baseline. Expand rollout once the performance targets and compatibility checks pass.

## Delivery sequence

1. **Baseline the current experience.** Time the capture client, API, storage, database, ingestion, and first-frame playback separately using the same fixtures and network profiles.
2. **Ship independent media and debugger readiness.** Return the link after the verified media and report are ready. Keep debugger processing durable and retryable. Ensure its upload and ingestion can finish after the link is available. Validate progress and recovery on constrained connections.
3. **Move backend workloads to Rust.** Start with debugger ingestion, including decompression, validation, and database writes. Compare p95 latency, CPU, memory, and failure recovery on equivalent workloads. Migrate report endpoints in slices and keep a route-level rollback path until contracts and results are verified.
4. **Move the dashboard and share page to React/Vite.** Carry forward authentication, deep links, report access, and playback behavior. Apply the same first-frame target to the new share page.
5. **Extend browser parity.** Prioritize recent-screen instant replay with explicit opt-in and timestamp share links. Review other Jam capabilities, such as external recording links and issue-tracker integrations, against user needs for subsequent releases.

Qdrant repository indexing is a separate developer tooling workstream. The capture and replay launch has no dependency on it.

## Decisions to validate

- Confirm baseline latency, supported browser coverage, and the most common capture sizes from representative sessions.
- Confirm the pilot mix of extension and embedded widget users and whether hosted and self-hosted installations require separate launch thresholds.
- Validate the buffering window, consent, and resource budget before committing to an instant replay release.
