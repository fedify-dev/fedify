 -  Added runtime version verification to `fedify init`. It checks that the
    selected Deno, Bun, or Node.js meets Fedify's minimum version, or a higher
    version required by a framework (such as Astro's Node.js 22.12), before
    generating a project. A missing, malformed, or unsupported runtime now
    produces a clear error in non-interactive mode and disables the affected
    package managers in interactive mode.  [[#964] by Lee Jeongmin]
