#!/bin/bash
# Check status of local Supabase instance

# Auto-detect script location and calculate workdir (parent directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(dirname "$SCRIPT_DIR")"  # infrastructure/supabase/

export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock
supabase status --workdir "$WORKDIR"
