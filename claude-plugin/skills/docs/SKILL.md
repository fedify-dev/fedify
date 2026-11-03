---
name: docs
description: >-
  Fetch and explain Fedify documentation on a specific topic. Use when the
  user asks about Fedify API details, configuration options, or how a
  specific feature works. Fetches up-to-date docs from fedify.dev.
argument-hint: <topic>
---

Fetch and explain Fedify documentation about “$ARGUMENTS”.

1.  Use WebFetch on the relevant fedify.dev page (append `.md` to get raw
    Markdown, e.g. `https://fedify.dev/manual/federation.md`).
    If WebFetch is unavailable, fall back to Bash:

    ~~~~ bash
    curl -sL https://fedify.dev/manual/federation.md
    ~~~~

    The documentation index is at <https://fedify.dev/llms.txt>.

2.  Summarize the key points with runnable TypeScript examples.

3.  Mention related pages the user might also want to read.

Always strip the `.md` suffix when presenting links to the user.
