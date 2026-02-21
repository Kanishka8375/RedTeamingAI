# RedTeamingAI

RedTeamingAI is an open-source AI agent security and trust layer.

It sits between your app and model providers, inspects tool calls, scores risk, enforces policy, and streams events to a dashboard in real time.

## Features

- **Proxy security gateway** for OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`)
- **3-engine security pipeline** (anomaly detection, policy engine, prompt injection scanner)
- **SQLite-backed event and analytics API**
- **Realtime dashboard** (events, cost/risk analytics, policy manager, top agents)
- **Compliance report generation** (PDF)
- **Alerts subsystem for security notifications**

## Quickstart

### 1) Clone and install

```bash
git clone https://github.com/Kanishka8375/RedTeamingAI.git
cd RedTeamingAI
npm install
```

### 2) Configure environment

```bash
cp .env.example .env
```

Minimum values for local dev:

- `PORT=3000`
- `API_PORT=4000`
- `DATABASE_PATH=./redteamingai.db`
- `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`

### 3) Start backend + dashboard

```bash
npm run dev
npm run dev:dashboard
```

- Proxy: `http://localhost:3000`
- API: `http://localhost:4000`
- Dashboard: `http://localhost:5173`

## Usage

Use your app against the proxy endpoint and send your customer key:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-RedTeamingAI-Key: demo" \
  -H "X-Agent-ID: my-agent" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'
```

## Open-source policy

- License: **MIT** (`LICENSE`)
- Contributions: see [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security reporting: see [`SECURITY.md`](SECURITY.md)
- Community standards: see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## Development checks

```bash
npm run build
npm test
```
