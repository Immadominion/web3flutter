#!/bin/bash

# Solana Flutter Skill installer
# Copies the skill into your Claude Code skills directory.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$SKILLS_DIR/solana-flutter"

echo "Installing Solana Flutter skill"
echo "  from: $SCRIPT_DIR/skill"
echo "  to:   $DEST"

mkdir -p "$DEST"
cp -R "$SCRIPT_DIR/skill/." "$DEST/"

if [ -d "$SCRIPT_DIR/commands" ]; then
  mkdir -p "$SKILLS_DIR/../commands" 2>/dev/null || true
fi

echo ""
echo "Done. Entry point: $DEST/SKILL.md"
echo "Claude Code auto-discovers skills under ~/.claude/skills."
echo "For other agents, point them at $DEST/SKILL.md."
