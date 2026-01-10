#!/bin/bash

set -e

# Activate mise for this session
eval "$(mise activate bash)"

# Run codegen
mise run codegen

# Show tool versions
echo
echo "INFO: Tool versions (managed by mise)"
mise ls
echo
