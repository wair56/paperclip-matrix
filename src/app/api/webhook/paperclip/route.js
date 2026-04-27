import { NextResponse } from 'next/server';
import { existsSync, createWriteStream, mkdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { getNodeSettings } from '@/lib/nodeSettings';
import { LOGS_DIR } from '@/lib/paths';
import { SandboxManager } from '@/lib/SandboxManager';
import getDb from '@/lib/db';
import { getExecutorFamily } from '@/lib/executors';
import { registerRunningProcess, unregisterRunningProcess } from '@/lib/runRegistry';
import { buildWebhookInvocation } from '@/lib/cliInvocation';

/**
 * Spawn a CLI process and capture its full stdout/stderr.
 * Returns a promise that resolves with { exitCode, stdout, stderr }.
 */
function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.onLog) options.onLog('stdout', text);
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.onLog) options.onLog('stderr', text);
    });

    if (options.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }

    proc.on('close', (code, signal) => {
      resolve({ exitCode: code, signal, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ exitCode: -1, signal: null, stdout, stderr: stderr + '\n' + err.message });
    });
  });
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

function parseContext(context) {
  if (!context) return {};
  if (typeof context === 'string') {
    try {
      return JSON.parse(context);
    } catch {
      return {};
    }
  }
  if (typeof context === 'object') return context;
  return {};
}

function extractTaskIdentifiers(context) {
  const ctx = parseContext(context);
  return {
    taskId: ctx.taskId || ctx.issueId || null,
    issueId: ctx.issueId || ctx.taskId || null,
  };
}

function extractSourceEventId(context) {
  const ctx = parseContext(context);
  const wakeCommentIds = Array.isArray(ctx.wakeCommentIds) ? ctx.wakeCommentIds.filter(Boolean) : [];
  const nestedWakeCommentIds = Array.isArray(ctx.paperclipWake?.commentIds)
    ? ctx.paperclipWake.commentIds.filter(Boolean)
    : [];
  return (
    ctx.wakeCommentId ||
    ctx.commentId ||
    ctx.paperclipWake?.latestCommentId ||
    wakeCommentIds[0] ||
    nestedWakeCommentIds[0] ||
    null
  );
}

function collapseBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function dedupeParagraphs(text) {
  const seen = new Set();
  const out = [];
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.join('\n\n');
}

function cleanAgentResponse(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const withoutSession = text.replace(/\nsession_id:[^\n]*\n?/g, '\n');
  const filtered = withoutSession
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^session_id:/.test(trimmed)) return false;
      if (/^┊\s/.test(trimmed)) return false;
      if (/^[╭╰│]/.test(trimmed)) return false;
      return true;
    })
    .join('\n');
  return collapseBlankLines(dedupeParagraphs(filtered));
}


function extractAgentMessageText(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const messages = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.type === 'agent_message' && typeof event.text === 'string') {
        messages.push(event.text);
      } else if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        messages.push(event.item.text);
      } else if (event?.type === 'message' && typeof event.content === 'string') {
        messages.push(event.content);
      } else if (event?.type === 'result' && typeof event.text === 'string') {
        messages.push(event.text);
      }
    } catch {}
  }

  return collapseBlankLines(messages.join('\n\n'));
}

function looksLikeRawExecutionJsonl(text) {
  const lines = String(text || '').split('\n').filter((line) => line.trim());
  return lines.length > 1 && lines.filter((line) => line.trim().startsWith('{')).length >= Math.min(3, lines.length);
}

function buildRemoteResponse(raw, status) {
  const agentText = extractAgentMessageText(raw);
  if (agentText) return cleanAgentResponse(agentText);

  const cleaned = cleanAgentResponse(raw);
  if (!cleaned) return status === 'completed' ? '任务已完成。' : '任务执行失败，请查看运行日志。';
  if (looksLikeRawExecutionJsonl(cleaned)) return status === 'completed' ? '任务已完成。' : '任务执行失败，请查看运行日志。';
  return cleaned;
}

function hasDeliverableResponse(raw, status) {
  const cleaned = buildRemoteResponse(raw, status);
  if (!cleaned) return false;
  if (status === 'completed' && cleaned === '任务已完成。' && looksLikeRawExecutionJsonl(cleanAgentResponse(raw))) {
    return false;
  }
  return true;
}

function buildIssueCommentBody(status, rawResponse, runId) {
  const marker = `<!-- paperclip-run:${runId} -->`;
  const cleaned = buildRemoteResponse(rawResponse, status);
  if (status === 'completed') {
    const body = cleaned || '任务已完成。';
    return `${body}\n\n${marker}`;
  }
  const fallback = cleaned || '任务执行失败，请查看运行日志。';
  return `本次任务执行失败。\n\n${fallback}\n\n${marker}`;
}

function responseNeedsFollowUp(rawResponse) {
  const agentText = extractAgentMessageText(rawResponse);
  const cleaned = cleanAgentResponse(agentText || rawResponse);
  if (!cleaned || looksLikeRawExecutionJsonl(cleaned)) return true;
  return [
    '请提供',
    '需要确认',
    '缺少',
    '无法确认',
    '无法完成',
    '请先提供',
    'please provide',
    'need more information',
    'need the following',
    'could you provide',
  ].some((pattern) => cleaned.toLowerCase().includes(pattern.toLowerCase()));
}

function extractCommentsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.comments)) return payload.comments;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function normalizeIssuePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.issue && typeof payload.issue === 'object') return payload.issue;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchIssueDetails({ apiUrl, apiKey, issueId, logToFile }) {
  if (!apiUrl || !apiKey || !issueId) return null;
  let lastError = '';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(`${apiUrl}/api/issues/${issueId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const issue = normalizeIssuePayload(await res.json().catch(() => null));
        if (issue?.title || issue?.identifier || issue?.description) return issue;
        lastError = 'empty issue payload';
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (e) {
      lastError = e?.message || String(e);
    }
    await sleep(Math.min(2000, attempt * 250));
  }
  logToFile?.('stderr', `[Matrix-Webhook] Issue context fetch failed for ${issueId}: ${lastError}\n`);
  return null;
}

function normalizeIssueComment(comment) {
  if (!comment || typeof comment !== 'object') return null;
  const body = comment.body ?? comment.text ?? comment.content ?? comment.message ?? '';
  if (!String(body).trim()) return null;
  return {
    id: comment.id || comment.commentId || null,
    body: String(body),
    createdAt: comment.createdAt || comment.updatedAt || null,
    actorType: comment.actorType || comment.authorType || null,
    actorId: comment.actorId || comment.authorId || comment.userId || comment.agentId || null,
    authorName: comment.authorName || comment.userName || comment.agentName || null,
  };
}

async function fetchIssueComments({ apiUrl, apiKey, issueId, logToFile }) {
  if (!apiUrl || !apiKey || !issueId) return [];
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${apiUrl}/api/issues/${issueId}/comments`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const payload = await res.json().catch(() => []);
        return extractCommentsPayload(payload).map(normalizeIssueComment).filter(Boolean);
      }
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e?.message || String(e);
    }
    await sleep(Math.min(1000, attempt * 200));
  }
  logToFile?.('stderr', `[Matrix-Webhook] Issue comments fetch failed for ${issueId}: ${lastError}\n`);
  return [];
}

function pickIssueContext(body, parsedContext, fetchedIssue) {
  const inlineIssue = normalizeIssuePayload(body?.issue || parsedContext?.issue || parsedContext?.paperclipIssue);
  const source = { ...(fetchedIssue || {}), ...(inlineIssue || {}) };
  return {
    id: source.id || parsedContext?.issueId || parsedContext?.taskId || body?.issueId || null,
    identifier: source.identifier || parsedContext?.identifier || parsedContext?.taskIdentifier || parsedContext?.taskKey || null,
    title: source.title || parsedContext?.title || parsedContext?.taskTitle || body?.title || null,
    description: source.description || parsedContext?.description || parsedContext?.taskDescription || body?.description || null,
    status: source.status || null,
    priority: source.priority || null,
    assigneeAgentId: source.assigneeAgentId || null,
  };
}

function hasMeaningfulIssueContext(issue) {
  return Boolean(issue?.title || issue?.description || issue?.identifier);
}

function sanitizePathSegment(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'unknown';
}

function getWakeCommentIds(parsedContext) {
  return [
    parsedContext?.wakeCommentId,
    parsedContext?.commentId,
    parsedContext?.paperclipWake?.latestCommentId,
    ...(Array.isArray(parsedContext?.wakeCommentIds) ? parsedContext.wakeCommentIds : []),
    ...(Array.isArray(parsedContext?.paperclipWake?.commentIds) ? parsedContext.paperclipWake.commentIds : []),
  ].filter(Boolean).map(String);
}

function getInlineWakeComments(parsedContext) {
  const comments = parsedContext?.paperclipWake?.comments;
  return Array.isArray(comments) ? comments : [];
}

const ASYNC_ACK_TEXT = '任务已接收，正在后台执行；完成后会在本任务下回复。';
const IGNORED_WAKE_TEXT = 'Ignored Paperclip-generated completion comment.';

function isPaperclipGeneratedCommentText(text) {
  const normalized = String(text || '').trim();
  return /<!--\s*paperclip-run:[^>]+-->/i.test(normalized)
    || normalized === ASYNC_ACK_TEXT
    || normalized === IGNORED_WAKE_TEXT;
}

function hasPaperclipGeneratedWakeComment(parsedContext) {
  return getInlineWakeComments(parsedContext).some((comment) => (
    isPaperclipGeneratedCommentText(comment?.body || comment?.text || comment?.content || '')
  ));
}

function hasPaperclipGeneratedTriggerComment(comments, parsedContext) {
  if (!Array.isArray(comments) || comments.length === 0) return false;
  const wakeIds = new Set(getWakeCommentIds(parsedContext));
  if (wakeIds.size === 0) return false;
  return comments.some((comment) => (
    comment?.id
    && wakeIds.has(String(comment.id))
    && isPaperclipGeneratedCommentText(comment.body)
  ));
}

function selectRelevantComments(comments, parsedContext, limit = 10) {
  if (!Array.isArray(comments) || comments.length === 0) return [];
  const wakeIds = new Set(getWakeCommentIds(parsedContext));
  const withIndex = comments.map((comment, index) => ({ comment, index }));
  const wakeComments = withIndex
    .filter(({ comment }) => comment.id && wakeIds.has(String(comment.id)))
    .map(({ comment }) => ({ ...comment, isTrigger: true }));
  const wakeSeen = new Set(wakeComments.map((comment) => String(comment.id)));
  const recentComments = withIndex
    .filter(({ comment }) => !comment.id || !wakeSeen.has(String(comment.id)))
    .sort((a, b) => {
      const at = a.comment.createdAt ? Date.parse(a.comment.createdAt) : 0;
      const bt = b.comment.createdAt ? Date.parse(b.comment.createdAt) : 0;
      if (bt !== at) return bt - at;
      return b.index - a.index;
    })
    .slice(0, Math.max(0, limit - wakeComments.length))
    .map(({ comment }) => comment);
  return [...wakeComments, ...recentComments].slice(0, limit);
}

function appendCommentsMarkdown(lines, comments) {
  if (!comments?.length) return;
  lines.push('', '## Relevant Comments');
  comments.forEach((comment, index) => {
    const heading = comment.isTrigger ? `Trigger Comment ${index + 1}` : `Comment ${index + 1}`;
    lines.push('', `### ${heading}`);
    if (comment.id) lines.push(`- ID: ${comment.id}`);
    if (comment.createdAt) lines.push(`- Created At: ${comment.createdAt}`);
    if (comment.authorName || comment.actorType || comment.actorId) {
      lines.push(`- Author: ${comment.authorName || comment.actorId || comment.actorType}`);
    }
    lines.push('', comment.body);
  });
}

function buildTaskContextMarkdown(issue, comments, parsedContext) {
  const lines = [
    '# Paperclip Task Context',
    '',
    'This file is the authoritative context for the current run. Ignore unrelated stale files from previous tasks unless this task explicitly asks you to use them.',
    '',
  ];
  if (issue?.identifier) lines.push(`- Identifier: ${issue.identifier}`);
  if (issue?.id) lines.push(`- Issue ID: ${issue.id}`);
  if (issue?.title) lines.push(`- Title: ${issue.title}`);
  if (issue?.status) lines.push(`- Status: ${issue.status}`);
  if (issue?.priority) lines.push(`- Priority: ${issue.priority}`);
  if (issue?.description) {
    lines.push('', '## Description', '', String(issue.description));
  }
  appendCommentsMarkdown(lines, comments);
  lines.push('', '## Raw Context', '', '```json', JSON.stringify(parsedContext || {}, null, 2), '```', '');
  return lines.join('\n');
}

function prepareTaskWorkspace({ sandbox, roleName, issue, comments, taskId, issueId, runId, parsedContext, envVars }) {
  const isolationDisabled = envVars.PAPERCLIP_TASK_WORKSPACE_ISOLATION === 'false';
  const taskKey = issue?.identifier || issueId || taskId || runId;
  const taskWorkspace = (isolationDisabled || !taskKey)
    ? sandbox.cwd
    : path.join(sandbox.cwd, 'tasks', sanitizePathSegment(taskKey));

  mkdirSync(taskWorkspace, { recursive: true });
  try {
    writeFileSync(
      path.join(taskWorkspace, 'TASK_CONTEXT.md'),
      buildTaskContextMarkdown(issue, comments, parsedContext),
      'utf8',
    );
    writeFileSync(
      path.join(taskWorkspace, '.paperclip-task.json'),
      JSON.stringify({ roleName, taskId, issueId, runId, issue, comments, context: parsedContext }, null, 2),
      'utf8',
    );
  } catch {}
  if (!isolationDisabled && taskKey) {
    sandbox.cwd = taskWorkspace;
    sandbox.env.WORK_DIR = taskWorkspace;
  }
  return taskWorkspace;
}

function shouldForwardTextChunk(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^session_id:/.test(trimmed)) return false;
  return true;
}

function buildIgnoredWakeResponse(runId) {
  return new Response(null, {
    status: 204,
    headers: {
      'X-Paperclip-Ignored-Run': String(runId || ''),
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

async function syncRunReplyToCloud({ identity, agentId, runId, status, response, code, finishedAt, logToFile }) {
  if (!identity.replyEndpoint || !agentId || !identity.apiKey || !runId) return false;
  logToFile('stdout', `[Matrix-Webhook] Sending ${status} callback to Cloud for Run ${runId}...\n`);
  try {
    const res = await fetch(identity.replyEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${identity.apiKey}`,
        'Content-Type': 'application/json',
        'X-Paperclip-Run-Id': runId,
      },
      body: JSON.stringify({
        status,
        response: buildRemoteResponse(response, status),
        exitCode: code,
        finishedAt: new Date(finishedAt).toISOString()
      })
    });
    if (res.ok) {
      logToFile('stdout', `[Matrix-Webhook] Successfully synced ${status} for Run ${runId}\n`);
      return true;
    } else {
      const errText = await res.text().catch(() => '');
      logToFile('stderr', `[Matrix-Webhook] Cloud sync failed for Run ${runId}: ${res.status}${errText ? ` ${errText}` : ''}\n`);
      return false;
    }
  } catch (e) {
    logToFile('stderr', `[Matrix-Webhook] Network error during Cloud sync for Run ${runId}: ${e?.message || String(e)}\n`);
    return false;
  }
}

function pickFirstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || null;
}

function resolveCloudReplyEndpoint({ body, parsedContext, identity, runId, runEnv }) {
  const explicitEndpoint = pickFirstString(
    body?.replyUrl,
    body?.replyURL,
    body?.replyCallbackUrl,
    body?.replyCallbackURL,
    body?.callbackUrl,
    body?.callbackURL,
    body?.callback?.url,
    parsedContext?.replyUrl,
    parsedContext?.replyCallbackUrl,
    parsedContext?.callbackUrl,
    parsedContext?.paperclipCallback?.url,
    parsedContext?.paperclipRun?.replyUrl,
  );
  if (explicitEndpoint) return explicitEndpoint;

  // The current hosted Paperclip API does not expose /api/runs/:id/reply.
  // Keep the legacy URL behind an opt-in for older/self-hosted clouds only.
  if (
    runEnv?.PAPERCLIP_LEGACY_RUN_REPLY === 'true'
    && identity?.apiUrl
    && runId
  ) {
    return `${identity.apiUrl}/api/runs/${runId}/reply`;
  }

  return null;
}

async function ensureIssueComment({ identity, issueId, runId, status, response, logToFile }) {
  if (!identity.apiUrl || !identity.apiKey || !issueId || !runId || status !== 'completed') return;
  const marker = `paperclip-run:${runId}`;
  const body = buildIssueCommentBody(status, response, runId);
  try {
    logToFile('stdout', `[Matrix-Webhook] Checking existing issue comments for Issue ${issueId} (Run ${runId})...\n`);
    const listRes = await fetch(`${identity.apiUrl}/api/issues/${issueId}/comments`, {
      headers: {
        'Authorization': `Bearer ${identity.apiKey}`,
        'Content-Type': 'application/json',
        'X-Paperclip-Run-Id': runId,
      }
    });
    if (listRes.ok) {
      const existingPayload = await listRes.json().catch(() => []);
      const existingComments = extractCommentsPayload(existingPayload);
      const alreadyPosted = existingComments.some((comment) => String(comment?.body || '').includes(marker));
      if (alreadyPosted) {
        logToFile('stdout', `[Matrix-Webhook] Issue comment already exists for Run ${runId}; skipping post.\n`);
        return;
      }
    } else {
      logToFile('stderr', `[Matrix-Webhook] Could not list issue comments for Issue ${issueId}: ${listRes.status}\n`);
    }

    logToFile('stdout', `[Matrix-Webhook] Posting completion comment to Issue ${issueId} for Run ${runId}...\n`);
    const postRes = await fetch(`${identity.apiUrl}/api/issues/${issueId}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${identity.apiKey}`,
        'Content-Type': 'application/json',
        'X-Paperclip-Run-Id': runId,
      },
      body: JSON.stringify({ body })
    });
    if (postRes.ok) {
      logToFile('stdout', `[Matrix-Webhook] Successfully posted issue comment for Run ${runId}\n`);
    } else {
      const errText = await postRes.text().catch(() => '');
      logToFile('stderr', `[Matrix-Webhook] Issue comment post failed for Run ${runId}: ${postRes.status}${errText ? ` ${errText}` : ''}\n`);
    }
  } catch (e) {
    logToFile('stderr', `[Matrix-Webhook] Issue comment writeback failed for Run ${runId}: ${e?.message || String(e)}\n`);
  }
}

async function ensureIssueDone({ identity, issueId, runId, status, logToFile }) {
  if (!identity.apiUrl || !identity.apiKey || !issueId || status !== 'completed') return;
  try {
    logToFile('stdout', `[Matrix-Webhook] Marking Issue ${issueId} done for Run ${runId}...\n`);
    const res = await fetch(`${identity.apiUrl}/api/issues/${issueId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${identity.apiKey}`,
        'Content-Type': 'application/json',
        ...(runId ? { 'X-Paperclip-Run-Id': runId } : {})
      },
      body: JSON.stringify({ status: 'done' })
    });
    if (res.ok) {
      logToFile('stdout', `[Matrix-Webhook] Successfully marked Issue ${issueId} done for Run ${runId}\n`);
    } else {
      const errText = await res.text().catch(() => '');
      logToFile('stderr', `[Matrix-Webhook] Issue status update failed for Run ${runId}: ${res.status}${errText ? ` ${errText}` : ''}\n`);
    }
  } catch (e) {
    logToFile('stderr', `[Matrix-Webhook] Issue status writeback failed for Run ${runId}: ${e?.message || String(e)}\n`);
  }
}

export async function POST(req) {
  let logStream;
  try {
    // Lightweight auth: if MATRIX_WEBHOOK_SECRET env var is set, require matching header
    const webhookSecret = process.env.MATRIX_WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = req.headers.get('x-matrix-secret');
      if (provided !== webhookSecret) {
        return NextResponse.json({ errorMessage: 'Unauthorized' }, { status: 401 });
      }
    }

    // Body size check
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_SIZE) {
      return NextResponse.json({ errorMessage: 'Request body too large' }, { status: 413 });
    }

    const body = JSON.parse(rawBody);
    const { runId, agentId, companyId, context } = body;
    const parsedContext = parseContext(context);
    console.log(`[Matrix-Webhook] Incoming run payload for Agent ${agentId} (Run: ${runId})`);

    if (hasPaperclipGeneratedWakeComment(parsedContext)) {
      console.log(`[Matrix-Webhook] Ignoring Paperclip-generated issue comment wakeup for Run ${runId}`);
      return buildIgnoredWakeResponse(runId);
    }
    
    // Dump the payload for debugging keys
    require('fs').appendFileSync(
      path.join(LOGS_DIR, 'webhook-debug.log'), 
      `\n[${new Date().toISOString()}] PAYLOAD:\n${JSON.stringify(body, null, 2)}\n`
    );

    // 1. Locate the correct local identity mapping
    const db = getDb();
    const identity = db.prepare(`SELECT * FROM identities WHERE agentId = ? AND status = 'active'`).get(agentId);

    if (!identity) {
      console.error(`[Matrix-Webhook] Agent ${agentId} not found in local vault.`);
      return NextResponse.json({ errorMessage: 'Agent not found in Matrix Vault' }, { status: 404 });
    }

    const roleName = identity.role;
    const receivedAt = Date.now();
    const dbRunId = runId || `local-${receivedAt}`;
    const resolvedCompanyId = companyId || identity.companyId;

    // 0. Extract Business Task ID (from context)
    const { taskId, issueId } = extractTaskIdentifiers(parsedContext);
    const sourceEventId = extractSourceEventId(parsedContext);

    // 0.1. Atomic Idempotency Check: Attempt to "claim" this runId in the DB
    if (runId) {
      try {
        if (taskId) {
          const activeTask = db.prepare(`SELECT runId FROM task_runs WHERE taskId = ? AND agentId = ? AND status = 'running'`).get(taskId, agentId);
          if (activeTask) {
             console.log(`[Matrix-Webhook] Ignoring retry for already running taskId ${taskId} (Original: ${activeTask.runId})`);
             return NextResponse.json({ 
               success: true, 
               message: 'Task is already being processed by this agent (taskId lock)',
               originalRunId: activeTask.runId
             });
          }
        }
        db.prepare(`INSERT INTO task_runs (id, runId, sourceEventId, taskId, companyId, agentId, role, receivedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`)
          .run(`${Date.now()}-${Math.random().toString(36).substring(2,9)}`, dbRunId, sourceEventId, taskId, resolvedCompanyId, agentId, roleName, receivedAt);
      } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
          const existing = db.prepare(`SELECT runId, status FROM task_runs WHERE runId = ? OR sourceEventId = ?`).get(runId, sourceEventId);
          if (existing && (existing.status === 'interrupted' || existing.status === 'error')) {
            const retryRunId = existing.runId || runId;
            console.log(`[Matrix-Webhook] Retrying previously ${existing.status} task runId: ${retryRunId}`);
            db.prepare(`UPDATE task_runs SET status = 'running', receivedAt = ?, response = NULL, repliedAt = NULL WHERE runId = ?`).run(receivedAt, retryRunId);
          } else {
            console.log(`[Matrix-Webhook] Skipping duplicate delivery for runId/sourceEventId: ${runId || sourceEventId} (Existing Status: ${existing?.status})`);
            return NextResponse.json({ 
              success: true, 
              message: 'Task already in progress or completed locally',
              status: existing?.status || 'unknown'
            });
          }
        } else {
          console.error('[Matrix-Webhook] Database error during idempotency claim:', e);
          throw e;
        }
      }
    }

    let envVars = {};
    try {
      envVars = JSON.parse(identity.envJson || '{}');
    } catch(e) {}

    const fetchedIssue = await fetchIssueDetails({
      apiUrl: identity.apiUrl,
      apiKey: identity.apiKey,
      issueId: issueId || taskId,
    });
    const issueComments = selectRelevantComments(
      await fetchIssueComments({
        apiUrl: identity.apiUrl,
        apiKey: identity.apiKey,
        issueId: issueId || taskId,
      }),
      parsedContext,
    );
    const issueContext = pickIssueContext(body, parsedContext, fetchedIssue);

    if (hasPaperclipGeneratedTriggerComment(issueComments, parsedContext)) {
      console.log(`[Matrix-Webhook] Ignoring fetched Paperclip-generated issue comment wakeup for Run ${runId}`);
      try {
        db.prepare(`UPDATE task_runs SET response = ?, repliedAt = ?, status = 'completed' WHERE runId = ?`)
          .run('Ignored Paperclip-generated completion comment.', Date.now(), dbRunId);
      } catch {}
      return buildIgnoredWakeResponse(runId);
    }

    // 0.2. Model & Executor Overrides (Priority: Payload > envVars > Identity Column)
    const payloadModel = body.model || body.runnerModel || parsedContext.model || null;
    const payloadExecutor = body.executor || body.runnerExecutor || parsedContext.executor || null;
    const finalExecutor = payloadExecutor || identity.executor || identity.executorName || 'hermes-local';
    const finalModel = payloadModel || envVars.RUNNER_MODEL || identity.model || null;

    // 2. Use SandboxManager for isolated execution environment
    //    Use the resolved executor name
    const sandbox = SandboxManager.getExecutionPayload(roleName, envVars, finalExecutor);
    const taskWorkspace = prepareTaskWorkspace({
      sandbox,
      roleName,
      issue: issueContext,
      comments: issueComments,
      taskId,
      issueId,
      runId,
      parsedContext,
      envVars,
    });
    console.log(`[Matrix-Webhook] Role: ${roleName} | Executor: ${sandbox.executorName} | Command: ${sandbox.resolvedBinary} | Sandbox HOME: ${sandbox.cwd}`);

    // 3. Overlay sandbox env with webhook-specific settings
    const runEnv = {
      ...sandbox.env,
      PAPERCLIP_RUN_ID: runId,
      PAPERCLIP_TASK_ID: taskId || '',
      PAPERCLIP_ISSUE_ID: issueId || '',
      PAPERCLIP_ISSUE_IDENTIFIER: issueContext.identifier || '',
      PAPERCLIP_ISSUE_TITLE: issueContext.title || '',
      PAPERCLIP_TASK_WORKSPACE: taskWorkspace,
    };

    // Inject proxy settings from global node config
    const nodeSettings = getNodeSettings();
    if (nodeSettings.proxy?.httpsProxy) {
      runEnv.HTTPS_PROXY = nodeSettings.proxy.httpsProxy;
      runEnv.HTTP_PROXY = nodeSettings.proxy.httpsProxy;
      runEnv.ALL_PROXY = nodeSettings.proxy.httpsProxy;
    }
    if (nodeSettings.proxy?.openaiBaseUrl) {
      runEnv.OPENAI_BASE_URL = nodeSettings.proxy.openaiBaseUrl;
    }

    // 4. Build CLI args
    const systemPrompt = body.instructions || body.systemPrompt || '';
    const taskContext = typeof context === 'string' ? context : JSON.stringify(parsedContext || '');
    
    let prompt = `You are agent ${agentId} (${roleName}). Continue your Paperclip work.\n`;
    if (systemPrompt) {
      prompt += `\n[YOUR IDENTITY & INSTRUCTIONS]\n${systemPrompt}\n\n`;
    }
    if (hasMeaningfulIssueContext(issueContext)) {
      prompt += `\n[CURRENT ISSUE - AUTHORITATIVE]\n`;
      if (issueContext.identifier) prompt += `Identifier: ${issueContext.identifier}\n`;
      if (issueContext.id) prompt += `Issue ID: ${issueContext.id}\n`;
      if (issueContext.title) prompt += `Title: ${issueContext.title}\n`;
      if (issueContext.status) prompt += `Status: ${issueContext.status}\n`;
      if (issueContext.priority) prompt += `Priority: ${issueContext.priority}\n`;
      if (issueContext.description) prompt += `Description:\n${issueContext.description}\n`;
      if (issueComments.length) {
        prompt += `\n[RELEVANT ISSUE COMMENTS - AUTHORITATIVE]\n`;
        for (const [index, comment] of issueComments.entries()) {
          const label = comment.isTrigger ? `Trigger Comment ${index + 1}` : `Comment ${index + 1}`;
          prompt += `\n${label}${comment.id ? ` (${comment.id})` : ''}${comment.createdAt ? ` at ${comment.createdAt}` : ''}:\n${comment.body}\n`;
        }
        prompt += `\nTreat trigger comments as the immediate instruction that caused this run.\n`;
      }
      prompt += `\nOnly work on this issue. Do not infer the task from unrelated files left in the workspace.\n`;
      prompt += `A copy of this context is available at ${path.join(taskWorkspace, 'TASK_CONTEXT.md')}.\n\n`;
    }
    if (taskContext && taskContext !== '""') {
      prompt += `[CURRENT TASK CONTEXT]\n${taskContext}\n`;
    }
    if (nodeSettings.agentRules?.globalPrompt) {
      prompt += `\n[GLOBAL MATRIX MANDATES]\n${nodeSettings.agentRules.globalPrompt}\n`;
    }
    const baseCmd = getExecutorFamily(sandbox.executorName);
    const skipPermissions = envVars.RUNNER_SKIP_PERMISSIONS !== 'false';
    const modelArg = (finalModel && finalModel !== 'auto') ? finalModel : null;
    const replyEndpoint = resolveCloudReplyEndpoint({
      body,
      parsedContext,
      identity,
      runId,
      runEnv,
    });
    const replyViaCallback = Boolean(replyEndpoint && runId && identity.apiKey);
    if ((body.replyTransport === 'callback' || body.replyCallback === true) && !replyEndpoint) {
      console.log(`[Matrix-Webhook] Callback transport requested for Run ${runId}, but no reply callback URL was provided. Relying on the streaming HTTP response.`);
    }
    const directIssueWriteback = body.directIssueWriteback === true || runEnv.PAPERCLIP_DIRECT_ISSUE_WRITEBACK === 'true';
    const shouldAutoCloseIssue = directIssueWriteback && (body.autoCloseIssue === true || runEnv.PAPERCLIP_AUTO_CLOSE_ISSUE === 'true');
    const cloudRequestedCallback = body.replyTransport === 'callback' || body.replyCallback === true;
    const asyncAckMode = runEnv.PAPERCLIP_ASYNC_ACK !== 'false' && !replyViaCallback;
    const shouldWriteIssueCommentOnFinish = directIssueWriteback
      || (cloudRequestedCallback && !replyEndpoint)
      || asyncAckMode;
    const { args, sendPromptToStdin } = buildWebhookInvocation({
      family: baseCmd,
      prompt,
      modelArg,
      skipPermissions,
    });

    // 5. Async logging via WriteStream
    const logFile = path.join(LOGS_DIR, `${roleName}.log`);
    logStream = createWriteStream(logFile, { flags: 'a' });

    const logToFile = (streamType, chunk) => {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${streamType.toUpperCase()}] `;
      const formatted = chunk.split('\n').map(line => prefix + line).join('\n') + '\n';
      logStream.write(formatted);
      if (process.env.DEBUG) console.log(`[Matrix-Webhook] ${streamType}: ${chunk.length} bytes`);
    };

    logToFile('stdout', `[Matrix-Webhook] Dispatching: ${sandbox.resolvedBinary} ${args.join(' ')}\n`);

    // UPDATE the prompt in DB since we inserted it without prompt earlier
    if (runId) {
      try {
        db.prepare(`UPDATE task_runs SET prompt = ? WHERE runId = ?`).run(prompt, dbRunId);
      } catch (e) { console.error('[Matrix-Webhook] Failed to update prompt in DB:', e); }
    } else {
      // For local runs without runId, we insert here instead
      try {
        db.prepare(`INSERT INTO task_runs (id, runId, sourceEventId, taskId, companyId, agentId, role, prompt, receivedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`)
          .run(`${Date.now()}-${Math.random().toString(36).substring(2,9)}`, dbRunId, sourceEventId, taskId, resolvedCompanyId, agentId, roleName, prompt, receivedAt);
      } catch(e) { console.error('[Matrix-Webhook] Failed to insert local task_run:', e); }
    }

    // 6. Execute in sandbox explicitly via Spawn to capture stream descriptors natively
    const proc = spawn(sandbox.resolvedBinary, args, {
      cwd: sandbox.cwd,
      env: runEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (sendPromptToStdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }

    // 7. Establish high-bandwidth HTTP reverse pipeline directly returning to the Cloud Webhook initiator
    let fullResponse = '';
    const encoder = new TextEncoder();
    let rawTextForwarded = false;
    const timeoutMs = Math.max(1, Number(runEnv.RUNNER_TIMEOUT_MS || identity.timeoutMs || 1800000));
    let timedOut = false;
    let interrupted = false;
    let interruptedReason = '';
    const timeoutHandle = Number.isFinite(timeoutMs) ? setTimeout(() => {
      timedOut = true;
      const timeoutMessage = `[Matrix-Webhook] Execution timed out after ${timeoutMs}ms\n`;
      fullResponse += `\n${timeoutMessage}`;
      logToFile('stderr', timeoutMessage);
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 5000);
    }, timeoutMs) : null;

    registerRunningProcess(dbRunId, {
      runId: dbRunId,
      role: roleName,
      startedAt: receivedAt,
      requestKill(reason = 'Killed by operator') {
        if (interrupted || timedOut) return false;
        interrupted = true;
        interruptedReason = reason;
        const killMessage = `[Matrix-Webhook] ${reason}\n`;
        fullResponse += `\n${killMessage}`;
        logToFile('stderr', killMessage);
        try { proc.kill('SIGTERM'); } catch {}
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
        }, 5000);
        return true;
      },
    });

    if (asyncAckMode) {
      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        fullResponse += text;
        logToFile('stdout', text);
      });

      proc.stderr.on('data', (chunk) => {
        const errText = chunk.toString();
        fullResponse += errText;
        logToFile('stderr', errText);
      });

      proc.on('close', async (code) => {
        unregisterRunningProcess(dbRunId);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        let status = interrupted ? 'interrupted' : (code === 0 ? 'completed' : 'error');
        if (status === 'completed' && !hasDeliverableResponse(fullResponse, status)) {
          status = 'error';
          fullResponse += '\n[Matrix-Webhook] Executor exited 0 but produced no final agent response.\n';
          logToFile('stderr', '[Matrix-Webhook] Executor exited 0 but produced no final agent response.\n');
        }
        const finishedAt = Date.now();
        try {
          db.prepare(`UPDATE task_runs SET response = ?, repliedAt = ?, status = ? WHERE runId = ?`)
            .run(fullResponse, finishedAt, status, dbRunId);
        } catch(e) { console.error('[Matrix-Webhook] Failed to update task_runs:', e); }

        if (replyViaCallback) {
          await syncRunReplyToCloud({
            identity: { ...identity, replyEndpoint },
            agentId,
            runId,
            status,
            response: fullResponse,
            code,
            finishedAt,
            logToFile,
          });
        }
        if (shouldWriteIssueCommentOnFinish) {
          await ensureIssueComment({
            identity,
            issueId: issueId || taskId,
            runId,
            status,
            response: fullResponse,
            logToFile,
          });
        }
        if (shouldAutoCloseIssue && !responseNeedsFollowUp(fullResponse)) {
          await ensureIssueDone({
            identity,
            issueId: issueId || taskId,
            runId,
            status,
            logToFile,
          });
        }

        logToFile('stdout', `\n[Matrix-Webhook] Background run completed with exit code ${code}\n`);
        logStream?.end();
      });

      proc.on('error', async (err) => {
        unregisterRunningProcess(dbRunId);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        logToFile('stderr', err.message);
        try {
          db.prepare(`UPDATE task_runs SET response = ?, repliedAt = ?, status = 'error' WHERE runId = ?`)
            .run(`${fullResponse}\n${err.message}`, Date.now(), dbRunId);
        } catch {}
        logStream?.end();
      });

      logToFile('stdout', `[Matrix-Webhook] Acknowledging Run ${runId} immediately; continuing in background.\n`);
      return new Response(`${JSON.stringify({
        type: 'result',
        status: 'completed',
        runId,
        text: ASYNC_ACK_TEXT,
      })}\n`, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    const stream = new ReadableStream({
      start: (controller) => {
        let streamClosed = false;
        const enqueueJson = (payload) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
          } catch {
            streamClosed = true;
          }
        };
        const closeStream = () => {
          if (streamClosed) return;
          streamClosed = true;
          if (heartbeatHandle) clearInterval(heartbeatHandle);
          try { controller.close(); } catch {}
        };
        enqueueJson({ type: 'status', status: 'running', runId });
        const heartbeatMs = Math.max(5000, Number(runEnv.PAPERCLIP_STREAM_HEARTBEAT_MS || 15000));
        const heartbeatHandle = setInterval(() => {
          enqueueJson({
            type: 'heartbeat',
            status: 'running',
            runId,
            ts: new Date().toISOString(),
          });
        }, heartbeatMs);

        proc.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          fullResponse += text;
          logToFile('stdout', text);
          
          if (baseCmd === 'hermes' || baseCmd === 'openclaw') {
            if (!rawTextForwarded && shouldForwardTextChunk(text)) {
              rawTextForwarded = true;
              enqueueJson({ type: 'status', status: 'running', runId });
            }
          } else {
            // Directly pass real-time JSONL payload native formats (tool calls, reasoning, etc) up to cloud
            if (!streamClosed) {
              try {
                controller.enqueue(chunk);
              } catch {
                streamClosed = true;
              }
            }
          }
        });

        proc.stderr.on('data', (chunk) => {
          const errText = chunk.toString();
          fullResponse += errText;
          logToFile('stderr', errText);
          // Standardize non-fatal adapter stderr warnings into wrapped JSONL objects to maintain JSONL shape
          const trimmed = errText.trim();
          if (trimmed) {
            const errPayload = { type: 'error', message: trimmed };
            enqueueJson(errPayload);
          }
        });

        proc.on('close', async (code, signal) => {
          unregisterRunningProcess(dbRunId);
          if (timeoutHandle) clearTimeout(timeoutHandle);
          let status = interrupted ? 'interrupted' : (code === 0 ? 'completed' : 'error');
          if (status === 'completed' && !hasDeliverableResponse(fullResponse, status)) {
            status = 'error';
            fullResponse += '\n[Matrix-Webhook] Executor exited 0 but produced no final agent response.\n';
            logToFile('stderr', '[Matrix-Webhook] Executor exited 0 but produced no final agent response.\n');
          }
          const finishedAt = Date.now();
          try {
             db.prepare(`UPDATE task_runs SET response = ?, repliedAt = ?, status = ? WHERE runId = ?`)
               .run(fullResponse, finishedAt, status, dbRunId);
          } catch(e) { console.error('[Matrix-Webhook] Failed to update task_runs:', e); }

          let callbackSynced = false;
          if (replyViaCallback) {
            callbackSynced = await syncRunReplyToCloud({
              identity: { ...identity, replyEndpoint },
              agentId,
              runId,
              status,
              response: fullResponse,
              code,
              finishedAt,
              logToFile,
            });
          }
          if (shouldWriteIssueCommentOnFinish) {
            await ensureIssueComment({
              identity,
              issueId: issueId || taskId,
              runId,
              status,
              response: fullResponse,
              logToFile,
            });
          }
          if (shouldAutoCloseIssue && !responseNeedsFollowUp(fullResponse)) {
            await ensureIssueDone({
              identity,
              issueId: issueId || taskId,
              runId,
              status,
              logToFile,
            });
          }

          logToFile('stdout', `\n[Matrix-Webhook] Completed with exit code ${code}\n`);
          const cleaned = buildRemoteResponse(fullResponse, status);
          if ((baseCmd === 'hermes' || baseCmd === 'openclaw') && status === 'completed' && cleaned) {
            enqueueJson({ type: 'text', text: cleaned });
          }
          enqueueJson({
            type: 'result',
            status,
            exitCode: code,
            runId,
            text: cleaned || undefined,
          });
          if (code !== 0 || timedOut || interrupted) {
            const finalPayload = {
              type: 'error',
              message: interrupted
                ? interruptedReason
                : (timedOut ? `Process timed out after ${timeoutMs}ms` : `Process exited with code ${code}`)
            };
            enqueueJson(finalPayload);
          }
          closeStream();
          logStream?.end();
        });

        proc.on('error', async (err) => {
          unregisterRunningProcess(dbRunId);
          if (timeoutHandle) clearTimeout(timeoutHandle);
          logToFile('stderr', err.message);
          try {
            db.prepare(`UPDATE task_runs SET response = ?, repliedAt = ?, status = 'error' WHERE runId = ?`)
              .run(`${fullResponse}\n${err.message}`, Date.now(), dbRunId);
          } catch {}
          const errPayload = { type: 'error', message: `Matrix OS Executor failure: ${err.message}` };
          enqueueJson(errPayload);
          closeStream();
          logStream?.end();
        });
      }
    });

    // Send the stream back through the proxy tunnel as active streaming data, 
    // eliminating 30/60s proxy timeouts by instantly acknowledging with headers.
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

  } catch (err) {
    if (logStream) logStream.end();
    console.error(`[Matrix-Webhook] Unhandled Failure:`, err);
    return NextResponse.json({
      type: 'error',
      message: `Matrix Execution Failure: ${err.message}`
    }, { status: 500 });
  }
}
