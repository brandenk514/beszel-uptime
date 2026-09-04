# beszel-uptime — Workspace Instructions

## Scope & Boundaries

- Work **only inside this workspace** (`/Users/brandenkaestner/Code/beszel-uptime`).
- Do **not** contribute to upstream repositories (e.g., `henrygd/beszel` on GitHub) unless the user explicitly asks in the current conversation.
- Customizations (skills, instructions, prompts) stay project-scoped under `.github/` unless asked otherwise.

## Project

- Go module (see `go.mod`); web UI is a Svelte/React-style app under `internal/site` (bun or npm).
- Key Make targets:
  - `make test` — `go test -tags='testing no_ui' ./...`
  - `make lint` — `golangci-lint run`
  - `make build` — builds agent + hub
- Agent lives under `agent/`, hub/server under `internal/hub`, entities under `internal/entities`.

## Conventions

- Prefer project-scoped customizations (`.github/skills/`, `.github/instructions/`).
- Before starting feature work, use the `using-git-worktrees` skill to set up an isolated workspace.
- Before finishing work, use the `finishing-git-worktree` skill to hand off (merge/PR) and clean up.
- Never force-push `main` or other shared branches.
