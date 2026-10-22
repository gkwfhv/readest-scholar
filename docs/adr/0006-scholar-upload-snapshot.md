# ADR 0006: Snapshot queued Scholar book bytes before upload

Status: accepted for the queued Scholar upload body on 2026-10-23; Phase 3 as a whole remains open.

## Context

A Scholar upload task already persists its account, operation ID, and expected active version. It still opens the current book file when the worker runs. If that file changes while the queue is paused, or between a timed-out PUT and a retry, one operation ID can refer to different bytes. The server correctly rejects the second fingerprint, but the client can no longer finish the original operation after a restart.

## Decision

On enqueue, copy the book body to an account- and operation-scoped path under the app Cache directory. A queued upload cannot begin network work until the copy has committed and its path has been persisted with the task. The worker reads only this copy on every attempt. A restored task with a recorded path must find that same copy; a missing copy fails visibly and requires a new operation. An old task from before this rule may not reuse its operation ID with newly read bytes.

The source remains untouched. Cache is private to the current app installation, so the queue does not copy it into account sync. After a task is fully committed and book metadata is saved, the cache copy can be removed. Failed and conflicted tasks retain the copy for an explicit retry or resolution. Clearing a task removes its copy. Web IndexedDB copying must resolve only when its write transaction completes.

## Consequences

Each queued PDF consumes temporary local space. Copy failures leave the original untouched and block upload. A source changed during the short copy window must be detected where the file system exposes stable size and modification time; regardless, no network call uses a partially staged copy. Account switching cannot consume a prior account's path. Unit and fault tests will cover pause/edit/resume, retry after lost response, restart, missing copy, account switch, and cleanup.

## Verification

The Web IndexedDB copy now resolves on transaction commit. The full app test suite, Linux CEF build, paused-source-mutation upload, and client restart/resume upload are recorded in [the Phase 3 snapshot evidence](../evidence/phase3/scholar-upload-snapshot-2026-10-23.md).
