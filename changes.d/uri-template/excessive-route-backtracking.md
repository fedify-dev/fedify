---
links:
  '#1325': https://github.com/fedify-dev/fedify/pull/1325
---
 -  Reduced excessive routing work on paths containing many colons, including
    paths with invalid percent encoding.  Candidate traversal avoids repeated
    states, and matching rejects output that the template cannot produce while
    preserving route priority and colon compatibility.  [[#1325]]
