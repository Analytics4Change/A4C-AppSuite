#!/bin/bash
# Start local Supabase instance using Podman

# Auto-detect script location and calculate workdir (parent directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(dirname "$SCRIPT_DIR")"  # infrastructure/supabase/

# Set Podman user socket
export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock

# Start Supabase with correct workdir
supabase start --workdir "$WORKDIR"

# Show connection info
echo ""
echo "=================================================="
echo "Local Supabase is running!"
echo "=================================================="
echo ""
echo "To stop: ./stop-local.sh"
echo "To view status: ./status-local.sh"
