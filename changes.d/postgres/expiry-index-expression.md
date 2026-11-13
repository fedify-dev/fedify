---
links:
  '#1434': https://github.com/fedify-dev/fedify/pull/1434
---
 -  Fixed duplicate expiry-index creation when reinitializing `PostgresKvStore`
    with an existing `AT TIME ZONE` index on PostgreSQL 18.7.  Index detection
    now checks the stored expression rather than index-definition syntax,
    preserving both documented `timezone()` and `AT TIME ZONE` forms.
    [[#1434]]
