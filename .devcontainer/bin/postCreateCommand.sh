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
mise exec -- deno completions bash > ~/.local/share/bash-completion/completions/deno

cat << 'EOF' >> ~/.bashrc
eval "$(mise activate bash)"
EOF

mise run install
