 -  Added the `@fedify/pglite` package with `PgliteKvStore`, a `KvStore` backed
    by an embedded PGlite database.  It accepts a caller-created PGlite instance
    and is intended for a single PGlite instance in a single runtime isolate; a
    message queue is not provided because PGlite does not share data between
    processes.  [[#1018]]
