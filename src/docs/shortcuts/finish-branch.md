---
name: finish-branch
description: After paw merge, decide what to do with the target branch — merge to main, create a PR, or keep as-is
---
All agent work is merged into the target branch. Verify the result, then
decide how to integrate it.

## Step 1: Verify the merged result

**Format, lint, typecheck, and test.** Run in this order. Check
`package.json`, `Makefile`, `pyproject.toml`, or similar for the project's
specific commands. Fix any failures before proceeding.

## Step 2: Determine the base branch

The base branch is usually `main`. Confirm:

```bash
git merge-base HEAD main 2>/dev/null
```

If the project uses a different default branch, ask the user.

## Step 3: Present options

Present exactly these options:

```
Target branch is ready. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work
```

Do not add explanation — keep options concise. Wait for the user to choose.

## Step 4: Execute the choice

### Option 1: Merge locally

```bash
git checkout <base-branch>
git pull
git merge <target-branch>
# If not a fast-forward, run format, lint, typecheck, and test again.
# Fix any failures before continuing.
git branch -d <target-branch>
```

### Option 2: Push and create a PR

```bash
git push -u origin <target-branch>
```

Scan the paw.yaml `issue` fields for GitHub issue numbers (e.g., `#123`).
Use `Closes #N` or `Fixes #N` in the PR body footer so GitHub auto-closes
them when the PR merges.

```bash
gh pr create \
  --base <base-branch> \
  --head <target-branch> \
  --title "<type>: <description>" \
  --body "$(cat <<'EOF'
## Summary

Brief description of what this branch delivers.

## What changed

- Change 1
- Change 2

## Test plan

- [ ] All N tests pass (M new + K existing)
- [ ] Full suite: N pass, N fail (note pre-existing failures if any)
- [ ] Lint clean
- [ ] Typecheck clean

Closes #123, Fixes #456
EOF
)"
```

Add additional sections to the PR body when the changes warrant it.

Wait for CI:

```bash
gh pr checks <target-branch> --watch 2>&1
```

If checks fail, fix, push, and wait again. Report the PR URL and CI status
to the user.

### Option 3: Keep as-is

Report: "Keeping branch `<target-branch>` as-is."

No further action needed.

### Option 4: Discard

Confirm before proceeding:

```
This will permanently delete:
- Branch <target-branch>
- All commits on it

Type 'discard' to confirm.
```

Wait for the user to type `discard` exactly. Then:

```bash
git checkout <base-branch>
git branch -D <target-branch>
```
