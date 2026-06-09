#!/usr/bin/env bash
set -e

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
die()     { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

# ── prereq checks ─────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm  >/dev/null 2>&1 || die "npm is not installed"

# ── .env / API key ────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn ".env not found — copied from .env.example"
  else
    die ".env file missing. Create one with OPENAI_API_KEY=sk-..."
  fi
fi

# shellcheck disable=SC2046
export $(grep -v '^#' .env | xargs)

if [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "sk-..." ]; then
  die "OPENAI_API_KEY is not set in .env"
fi
success "OPENAI_API_KEY loaded"

# ── node_modules ──────────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  info "node_modules not found — running npm install..."
  npm install --silent
  success "dependencies installed"
fi

# ── cleanup on exit ───────────────────────────────────────────────────────────
MCP_PID=""
API_PID=""

cleanup() {
  echo ""
  info "shutting down..."
  [ -n "$MCP_PID" ] && kill "$MCP_PID" 2>/dev/null
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# ── start MCP server ──────────────────────────────────────────────────────────
info "starting MCP server on :3001..."
node mcp-server.js &
MCP_PID=$!

# wait until port 3001 is accepting connections (max 10 s)
for i in $(seq 1 20); do
  if nc -z localhost 3001 2>/dev/null; then
    success "MCP server ready (pid $MCP_PID)"
    break
  fi
  [ "$i" -eq 20 ] && die "MCP server did not start in time"
  sleep 0.5
done

# ── start API server ──────────────────────────────────────────────────────────
info "starting API server on :3000..."
node server.js &
API_PID=$!

# wait until port 3000 is accepting connections (max 10 s)
for i in $(seq 1 20); do
  if nc -z localhost 3000 2>/dev/null; then
    success "API server ready  (pid $API_PID)"
    break
  fi
  [ "$i" -eq 20 ] && die "API server did not start in time"
  sleep 0.5
done

# ── open browser ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}──────────────────────────────────────────${RESET}"
echo -e "${GREEN}  App running at http://localhost:3000${RESET}"
echo -e "${BOLD}──────────────────────────────────────────${RESET}"
echo ""
echo -e "  Try asking:"
echo -e "  • ${CYAN}What is the weather in Tokyo?${RESET}"
echo -e "  • ${CYAN}What time is it in New York?${RESET}"
echo -e "  • ${CYAN}Tell me about MCP${RESET}"
echo ""
echo -e "  Press ${BOLD}Ctrl+C${RESET} to stop both servers"
echo ""

# macOS — open browser automatically
if command -v open >/dev/null 2>&1; then
  open "http://localhost:3000"
fi

# ── keep script alive so trap works ──────────────────────────────────────────
wait
