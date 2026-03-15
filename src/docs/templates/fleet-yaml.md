---
name: fleet-yaml
description: Annotated config structure for .fleet/fleet.yaml
roles: [orchestrator]
---
```yaml
# .fleet/fleet.yaml — defines parallel agent tasks for a fleet session

target: feature/my-feature
# base: main                              # default: main
model: sonnet                             # sonnet or opus
# spec: .fleet/specs/spec-2026-03-04-my-feature.md

# include:                                # gitignored files to copy into each worktree
#   - .env
#   - .env.local
#   - "config/local.json"

tasks:
  # Each key is the task name → branch suffix and worktree directory.
  #   Branch:    {target}-{taskName}
  #   Worktree:  {repoName}-fleet-{taskName}
  #
  # Prompt language:
  #   - Declarative for goals: "The service handles X with Y guarantees"
  #   - Imperative for actions: "Build X. Define Y. Import Z."
  #   - Keep sentences concise (~21 words). Be explicit — frontier models
  #     implement only what's stated.
  #   - State constraints positively: "use X" not "never do Y"
  #
  # Each prompt includes:
  #   1. Goal — declarative end-state (what success looks like)
  #   2. Deliverables — imperative actions with concrete outputs
  #   3. Interface contract — what this task provides to or consumes from others
  #   4. Acceptance criteria — specific, testable behaviors

  schema:
    focus:                                 # Explicit file ownership — no overlap
      - src/db/migrations/
      - src/db/schema.ts

    issue: GH#30
    # model: opus                         # override top-level model for this task
    # depends_on: other-task              # merge after this task completes
    # depends_on:                         # or a list of dependencies
    #   - task-a
    #   - task-b
    prompt: |
      The notifications table stores per-user events with type, payload,
      read status, and created timestamp.

      Add migration 003_notifications. Define Notification type
      (id, userId, type, payload, read, createdAt) in src/db/schema.ts —
      the service and api tasks import this type.

      Acceptance: migration runs idempotently, rollback drops the table,
      schema type-checks against the migration columns.

  service:
    focus:
      - src/services/notification.ts
      - src/services/notification.test.ts
    depends_on: schema                     # Consumer merges after producer
    issue: GH#31
    prompt: |
      The notification service handles creation, retrieval, and
      mark-as-read for user notifications.

      Import Notification from src/db/schema.ts. Implement create,
      listByUser (paginated, newest first), and markRead methods.
      Emit a "notification:created" event on create — the worker
      task listens for this event.

      Acceptance: create returns the new notification, listByUser
      paginates with cursor, markRead is idempotent on already-read items.

  worker:
    focus:
      - src/workers/notify.ts
      - src/workers/notify.test.ts
    depends_on: schema
    issue: GH#32
    prompt: |
      The background worker delivers notifications through email and
      in-app channels based on user preferences.

      Listen for "notification:created" events. Route each notification
      to the appropriate channel using the user's delivery preferences.
      Retry failed deliveries with exponential backoff (3 attempts max).

      Acceptance: email channel calls the mailer service, in-app channel
      writes to the push queue, failed deliveries retry then log errors.

  api:
    focus:
      - src/api/notifications.ts
      - src/routes/notifications.ts
    depends_on: service
    issue: GH#33
    prompt: |
      REST endpoints expose notification data for authenticated users.

      Import Notification from src/db/schema.ts. Build GET /notifications
      (paginated, filtered by read status) and PATCH /notifications/:id/read.
      Require authentication on all endpoints.

      Acceptance: GET returns paginated array, PATCH marks as read and
      returns updated notification, 401 for unauthenticated, 404 for
      missing notification.
```
