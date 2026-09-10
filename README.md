# HYDRA — AI Traffic Controller

> Single API endpoint. Multiple AI models. You define the rules.

HYDRA is a model router that sits in front of Claude, GPT, Gemini, and local (Ollama) models. Send any request to HYDRA's OpenAI-compatible API and it decides which model gets it — based on complexity, token count, cost budget, and rules you define in a JSON config.

```
Your app → HYDRA :3000 → Claude Haiku   (simple queries)
                        → GPT-4o-mini   (cheap short tasks)
                        → Claude Sonnet  (medium complexity)
                        → Claude Opus    (hard reasoning)
                        → Gemini Pro    (huge contexts)
                        → Ollama/local   (tagged "local")
```

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo> && cd hydra
npm install

# 2. Configure
cp .env.example .env
# Add your API keys to .env

# 3. Start
npm run dev       # dev mode with hot reload
npm start         # production (after npm run build)
```

Server starts at `http://localhost:3000`.

---

## Usage

HYDRA is a drop-in for any OpenAI SDK call:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your-hydra-api-key"   # set HYDRA_API_KEY in .env
)

response = client.chat.completions.create(
    model="auto",   # HYDRA ignores this — it decides
    messages=[{"role": "user", "content": "Explain quantum entanglement in depth"}]
)

# Response includes routing metadata:
# response.hydra.rule          → "high-complexity-reasoning"
# response.hydra.modelAlias    → "claude-power"
# response.hydra.costUSD       → 0.00312
```

### HYDRA extensions

Add a `hydra` object to any request for fine-grained control:

```json
{
  "model": "auto",
  "messages": [...],
  "hydra": {
    "tags": ["local"],          // force-tag for rule matching
    "costBudget": 0.005,        // max USD for this request
    "forceModel": "gpt-fast"    // override routing entirely
  }
}
```

---

## Routing Config (`config/routing.json`)

### Models

Define model aliases with cost and capability metadata:

```json
{
  "models": {
    "claude-smart": {
      "provider": "anthropic",
      "model": "claude-sonnet-5",
      "costPerMInputTokens": 3.00,
      "costPerMOutputTokens": 15.00,
      "maxContextTokens": 200000,
      "latencyClass": "medium"
    }
  }
}
```

### Rules

Rules are evaluated by priority (lower = higher priority). First match wins:

```json
{
  "rules": [
    {
      "name": "simple-short-to-cheap",
      "priority": 10,
      "conditions": [
        { "field": "complexity", "operator": "lt", "value": 25 },
        { "field": "token_count", "operator": "lt", "value": 500 }
      ],
      "target": "gpt-fast",
      "fallback": "claude-fast"
    }
  ]
}
```

**Condition fields:**

| Field | Description |
|---|---|
| `complexity` | 0–100 score (heuristic: length, code, reasoning keywords, turn depth) |
| `token_count` | Estimated input tokens |
| `tag` | String-contains match against request tags |
| `keyword` | String-contains match against detected keywords |
| `cost_budget` | Compares against `hydra.costBudget` in the request |

**Operators:** `lt`, `lte`, `gt`, `gte`, `eq`, `contains`, `not_contains`

---

## API Reference

### `POST /v1/chat/completions`
OpenAI-compatible. HYDRA ignores the `model` field and routes based on rules.

### `POST /hydra/classify`
Dry-run: classify a request and see how it would be routed.

```bash
curl -X POST http://localhost:3000/hydra/classify \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Write a recursive fibonacci in Rust"}]}'
```

### `GET /hydra/stats`
Cost, usage, and routing statistics.

### `GET /hydra/logs?limit=50`
Recent routing decisions.

### `GET /hydra/config`
Current routing config.

### `POST /hydra/config/reload`
Hot-reload `routing.json` without restarting.

---

## Dashboard

Open `http://localhost:3000/dashboard` for a live view of routing decisions, cost breakdown by model, and the route simulator.

---

## Architecture

```
Request
  │
  ▼
HydraRouter.decide()
  │
  ├── classify() — complexity score, token estimate, tags, keywords
  │
  └── Rule engine — evaluate conditions in priority order
        │
        ├── Match → getAdapter(provider) → complete() / stream()
        │              │
        │              └── on error → fallback model
        │
        └── No match → defaultModel
              │
              └── CostTracker.record()
```

---

## Complexity Scoring

The classifier runs locally in <1ms. Signals:

- **Token count** — longer = higher complexity
- **Code presence** — fenced code blocks, inline code, code keywords
- **Reasoning keywords** — "analyze", "compare", "design", "tradeoff", etc.
- **Simple keyword penalty** — "translate", "list", "hello" lower the score
- **Multi-turn depth** — more conversation turns = higher complexity
- **Question count** — multiple questions suggest more complex needs
- **Sentence complexity** — average sentence length

Score range: 0 (trivial) → 100 (maximum complexity).

---

## License
MIT — Quantum Fabric Industries
