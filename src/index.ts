// ─── HYDRA — AI Traffic Controller ───────────────────────────────────────────
//
//   Single API endpoint. Multiple AI models. You define the rules.
//   OpenAI-compatible interface — drop in as a replacement for any OpenAI SDK call.
//
//   Usage:
//     curl http://localhost:3000/v1/chat/completions \
//       -H "Authorization: Bearer $HYDRA_API_KEY" \
//       -H "Content-Type: application/json" \
//       -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { HydraRouter } from './router';
import { buildChatRouter } from './routes/chat';
import { buildAdminRouter } from './routes/admin';
import { requireApiKey } from './middleware/auth';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  if (req.path !== '/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Router ────────────────────────────────────────────────────────────────────
const hydra = new HydraRouter();

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'hydra-router', version: '1.0.0' });
});

// OpenAI-compatible chat API (requires API key if configured)
app.use('/v1', requireApiKey, buildChatRouter(hydra));

// HYDRA admin API (requires API key if configured)
app.use('/hydra', requireApiKey, buildAdminRouter(hydra));

// Dashboard static page
app.get('/dashboard', (_req, res) => {
  res.sendFile('dashboard.html', { root: __dirname + '/../' });
});

// ── Startup ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ██╗  ██╗██╗   ██╗██████╗ ██████╗  █████╗ ');
  console.log('  ██║  ██║╚██╗ ██╔╝██╔══██╗██╔══██╗██╔══██╗');
  console.log('  ███████║ ╚████╔╝ ██║  ██║██████╔╝███████║');
  console.log('  ██╔══██║  ╚██╔╝  ██║  ██║██╔══██╗██╔══██║');
  console.log('  ██║  ██║   ██║   ██████╔╝██║  ██║██║  ██║');
  console.log('  ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝');
  console.log('');
  console.log('  AI Traffic Controller — Multi-Model Router');
  console.log(`  Server:    http://localhost:${PORT}`);
  console.log(`  API:       http://localhost:${PORT}/v1/chat/completions`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`  Admin:     http://localhost:${PORT}/hydra/stats`);
  console.log('');

  const config = hydra.getConfig();
  const modelCount = Object.keys(config.models).length;
  const ruleCount = config.rules.length;
  console.log(`  Loaded: ${modelCount} models, ${ruleCount} routing rules`);
  console.log(`  Default: ${config.defaultModel}`);
  console.log('');
});

export default app;
