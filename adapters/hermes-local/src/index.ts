/**
 * Hermes Agent adapter for Paperclip.
 *
 * Runs Hermes Agent (https://github.com/NousResearch/hermes-agent)
 * as a managed employee in a Paperclip company. Hermes Agent is a
 * full-featured AI agent with 30+ native tools, persistent memory,
 * skills, session persistence, and MCP support.
 *
 * @packageDocumentation
 */

import { ADAPTER_TYPE, ADAPTER_LABEL } from "./shared/constants.js";

export const type = ADAPTER_TYPE;
export const label = ADAPTER_LABEL;

/**
 * Models available through Hermes Agent (synced from LiteLLM).
 */
export const models: { id: string; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "dmx-gpt-5.4", label: "DMX GPT-5.4" },
  { id: "dmx-gpt-5.4-mini", label: "DMX GPT-5.4 Mini" },
  { id: "dmx-claude-sonnet-4-6", label: "DMX Claude Sonnet 4.6" },
  { id: "codechn-gpt-5.4", label: "CodeCHN GPT-5.4" },
  { id: "openai-gpt-5.4", label: "OpenAI GPT-5.4" },
  { id: "ark-coding-claude-sonnet", label: "Ark Claude Sonnet" },
  { id: "ark-coding-gpt-5.4", label: "Ark GPT-5.4" },
  { id: "codechn-gpt-5.2-codex", label: "CodeCHN GPT-5.2 Codex" },
  { id: "codechn-gpt-5.3-codex", label: "CodeCHN GPT-5.3 Codex" },
  { id: "ark-code-latest", label: "Ark Code Latest" },
  { id: "doubao-seed-code", label: "Doubao Seed Code" },
  { id: "kimi-k2.5", label: "Kimi K2.5" },
  { id: "glm-4.7", label: "GLM 4.7" },
  { id: "deepseek-v3.2", label: "DeepSeek V3.2" },
  { id: "doubao-seed-2.0-code", label: "Doubao Seed 2.0 Code" },
  { id: "doubao-seed-2.0-pro", label: "Doubao Seed 2.0 Pro" },
  { id: "doubao-seed-2.0-lite", label: "Doubao Seed 2.0 Lite" },
  { id: "minimax-m2.5", label: "MiniMax M2.5" },
  { id: "glm-5.1", label: "GLM 5.1" },
];

/**
 * Documentation shown in the Paperclip UI when configuring a Hermes agent.
 */
export const agentConfigurationDoc = `# Hermes Agent Configuration

Hermes Agent is a full-featured AI agent by Nous Research with 30+ native
tools, persistent memory, session persistence, skills, and MCP support.

## Prerequisites

- Python 3.10+ installed
- Hermes Agent installed: \`pip install hermes-agent\`
- At least one LLM API key configured in ~/.hermes/.env

## Core Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| model | string | (Hermes configured default) | Optional explicit model in provider/model format. Leave blank to use Hermes's configured default model. |
| provider | string | (auto) | API provider: auto, openrouter, nous, openai-codex, zai, kimi-coding, minimax, minimax-cn. Usually not needed — Hermes auto-detects from model name. |
| timeoutSec | number | 300 | Execution timeout in seconds |
| graceSec | number | 10 | Grace period after SIGTERM before SIGKILL |

## Tool Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| toolsets | string | (all) | Comma-separated toolsets to enable (e.g. "terminal,file,web") |

## Session & Workspace

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| persistSession | boolean | true | Resume sessions across heartbeats |
| worktreeMode | boolean | false | Use git worktree for isolated changes |
| checkpoints | boolean | false | Enable filesystem checkpoints |

## Advanced

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| hermesCommand | string | hermes | Path to hermes CLI binary |
| verbose | boolean | false | Enable verbose output |
| extraArgs | string[] | [] | Additional CLI arguments |
| env | object | {} | Extra environment variables |
| promptTemplate | string | (default) | Custom prompt template with {{variable}} placeholders |

## Available Template Variables

- \`{{agentId}}\` — Paperclip agent ID
- \`{{agentName}}\` — Agent display name
- \`{{companyId}}\` — Paperclip company ID
- \`{{companyName}}\` — Company display name
- \`{{runId}}\` — Current heartbeat run ID
- \`{{taskId}}\` — Current task/issue ID (if assigned)
- \`{{taskTitle}}\` — Task title (if assigned)
- \`{{taskBody}}\` — Task description (if assigned)
- \`{{projectName}}\` — Project name (if scoped to a project)
`;
