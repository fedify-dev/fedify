#!/bin/bash

set -e

# Disable GPG verification for Node.js (GPG keys not available in container)
export MISE_NODE_VERIFY=false

# mise trust and install tools from mise.toml
mise trust
mise install

# Setup shell completions in user directory
mkdir -p ~/.local/share/bash-completion/completions/
mise completion bash > ~/.local/share/bash-completion/completions/mise
# Deno is optional for development (MISE_DISABLE_TOOLS=deno skips it), so only
# set up its completions when it is installed.
if mise exec -- deno --version > /dev/null 2>&1; then
  mise exec -- deno completions bash > ~/.local/share/bash-completion/completions/deno
fi

cat << 'EOF' >> ~/.bashrc
eval "$(mise activate bash)"
EOF

# Install project dependencies via mise's deps providers (`pnpm install`, which
# builds all packages through its `prepare` lifecycle script, and vocabulary
# code generation).  They do not prepare a Deno cache; run
# `mise run deno:cache` for Deno-specific work.
mise deps
