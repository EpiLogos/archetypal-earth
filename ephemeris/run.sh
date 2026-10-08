#!/usr/bin/env bash
# Start the ephemeris sidecar on 127.0.0.1:5187 (localhost only).
# First run: python3 -m venv ephemeris/.venv && ephemeris/.venv/bin/pip install -r ephemeris/requirements.txt
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "ephemeris/.venv is missing. Create it with:" >&2
  echo "  python3 -m venv ephemeris/.venv && ephemeris/.venv/bin/pip install -r ephemeris/requirements.txt" >&2
  exit 1
fi
exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port "${EPHEMERIS_PORT:-5187}"
