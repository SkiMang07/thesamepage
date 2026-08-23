# Claude remote Git fallback

Read this only when the agent cannot write to the local Git repository directly and Claude's remote-device tooling is the available bridge.

The device-side repository is:

`/Users/andrewgodlewski/Desktop/Obsidian/main/01 Projects/The Same Page/`

In a remote-device shell it may appear as `mnt/The Same Page` relative to the session home. Use the remote shell to inspect status and diffs and to apply the already-triaged documentation edits. If the device is not connected, stop rather than guessing at file contents.

When direct commit and push remain unavailable, give Andrew one paste-ready block with explicit paths:

```bash
cd "/Users/andrewgodlewski/Desktop/Obsidian/main/01 Projects/The Same Page"
rm -f .git/index.lock
git add <specific files>
git commit -m "<imperative subject>" -m "<concise why or durable decisions, when needed>"
git push
```

The lock removal is a project-specific fallback for a stale lock repeatedly left by the remote session tooling. Use it only in this handed-off command and only when no other Git process is running. Never stage unrelated files.
