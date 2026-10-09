#!/usr/bin/env bash
# Build the public download package: the RESEARCH LAYER of the vault.
# Carries references and citation-grade quotes — NOT the corpus text, NOT the plates.
# The full-text layer (corpus/, _raw/) stays on the owner's machine.
set -euo pipefail
VAULT="${VAULT:-$HOME/Documents/Books/jung-archetypal-field}"
OUT="${1:-dist-downloads}"
mkdir -p "$OUT"

# One package: the vault as an Obsidian research vault, minus the copyrighted layers.
( cd "$VAULT" && zip -qr "$OLDPWD/$OUT/jung-archetypal-field-vault-obsidian.zip" . \
    -x "corpus/*" -x "_raw/*" -x "data/paragraphs.jsonl" -x ".obsidian/workspace*" )

( cd "$OUT" && shasum -a 256 *.zip > SHA256SUMS )
ls -lh "$OUT"
echo "research layer only: references + notes + structure. corpus/ and plates stay home."
echo "upload to a GitHub Release on the site repo; the landing Downloads button links there."
