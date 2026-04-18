import { NextResponse } from 'next/server';
import { existsSync, createWriteStream } from 'fs';
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

function buildIssueCommentBody(status, rawResponse, runId) {
  const marker = `<!-- paperclip-run:${runId} -->`;
  const cleaned = cleanAgentResponse(rawResponse);
  if (status === 'completed') {
    const body = cleaned || '任务已完成。';
    return `${body}\n\n${marker}`;
  }
  const fallback = cleaned || '任务执行失败，请查看运行日志。';
  return `本次任务执行失败。\n\n${fallback}\n\n${marker}`;
}

function responseNeedsFollowUp(rawResponse) {
  const cleaned = cleanAgentResponse(rawResponse);
  if (!cleaned) return true;
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

function shouldForwardTextChunk(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^session_id:/.test(trimmed)) return false;
  return true;
}

async function syncRunReplyToCloud({ identity, agentId, runId, status, response, code, finishedAt, logToFile }) {
  if (!identity.apiUrl || !agentId || !identity.apiKey || !runId) return;
  logToFile('stdout', `[Matrix-Webhook] Sending ${status} callback to Cloud for Run ${runId}...\n`);
  try {
    const res = await fetch(`${identity.apiUrl}/api/runs/${runId}/reply`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${identity.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status,
        response,
        exitCode: code,
        finishedAt: new Date(finishedAt).toISOString()
      })
    });
    if (res.ok) {
      logToFile('stdout', `[Matrix-Webhook] Successfully synced ${status} for Run ${runId}\n`);
    } else {
      const errText = await res.text().catch(() => '');
      logToFile('stderr', `[Matrix-Webhook] Cloud sync failed for Run ${runId}: ${res.status}${errText ? ` ${errText}` : ''}\n`);
    }
  } catch (e) {
    logToFile('stderr', `[Matrix-Webhook] Network error during Cloud sync for Run ${runId}: ${e?.message || String(e)}\n`);
  }
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
        'Content-Type': 'application/json'
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
        'Content-Type': 'application/json'
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
        'Content-Type': 'application/json'
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

    // 0.2. Model & Executor Overrides (Priority: Payload > envVars > Identity Column)
    const payloadModel = body.model || body.runnerModel || parsedContext.model || null;
    const payloadExecutor = body.executor || body.runnerExecutor || parsedContext.executor || null;
    const finalExecutor = payloadExecutor || identity.executor || identity.executorName || 'hermes-local';
    const finalModel = payloadModel || envVars.RUNNER_MODEL || identity.model || null;

    // 2. Use SandboxManager for isolated execution environment
    //    Use the resolved executor name
    const sandbox = SandboxManager.getExecutionPayload(roleName, envVars, finalExecutor);
    console.log(`[Matrix-Webhook] Role: ${roleName} | Executor: ${sandbox.executorName} | Command: ${sandbox.resolvedBinary} | Sandbox HOME: ${sandbox.cwd}`);

    // 3. Overlay sandbox env with webhook-specific settings
    const runEnv = {
      ...sandbox.env,
      PAPERCLIP_RUN_ID: runId,
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
    if (taskContext && taskContext !== '""') {
      prompt += `[CURRENT TASK CONTEXT]\n${taskContext}\n`;
    }
    if (nodeSettings.agentRules?.globalPrompt) {
      prompt += `\n[GLOBAL MATRIX MANDATES]\n${nodeSettings.agentRules.globalPrompt}\n`;
    }
    const baseCmd = getExecutorFamily(sandbox.executorName);
    const skipPermissions = envVars.RUNNER_SKIP_PERMISSIONS !== 'false';
    const modelArg = (finalModel && finalModel !== 'auto') ? finalModel : null;
    const replyViaCallback = body.replyTransport === 'callback' || body.replyCallback === true;
    const shouldAutoCloseIssue = body.autoCloseIssue === true || runEnv.PAPERCLIP_AUTO_CLOSE_ISSUE === 'true';
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
    const stream = new ReadableStream({
      start: (controller) => {
        proc.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          fullResponse += text;
          logToFile('stdout', text);
          
          if (baseCmd === 'hermes' || baseCmd === 'openclaw') {
            if (!rawTextForwarded && shouldForwardTextChunk(text)) {
              rawTextForwarded = true;
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'status', status: 'running' }) + '\n'));
            }
          } else {
            // Directly pass real-time JSONL payload native formats (tool calls, reasoning, etc) up to cloud
            controller.enqueue(chunk); 
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
            controller.enqueue(encoder.encode(JSON.stringify(errPayload) + '\n'));
          }
        });

        proc.on('close', async (code, signal) => {
          unregisterRunningProcess(dbRunId);
          if (timeoutHandle) clearTimeout(timeoutHandle);
          const status = interrupted ? 'interrupted' : (code === 0 ? 'completed' : 'error');
          const finishedAt = Date.now();
          try {
             db.prepare(`UPDATE task_runs SET response = ?, repliedAt = ?, status = ? WHERE runId = ?`)
               .run(fullResponse, finishedAt, status, dbRunId);
          } catch(e) { console.error('[Matrix-Webhook] Failed to update task_runs:', e); }

          if (replyViaCallback) {
            await syncRunReplyToCloud({
              identity,
              agentId,
              runId,
              status,
              response: fullResponse,
              code,
              finishedAt,
              logToFile,
            });
          }
          await ensureIssueComment({
            identity,
            issueId: issueId || taskId,
            runId,
            status,
            response: fullResponse,
            logToFile,
          });
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
          if ((baseCmd === 'hermes' || baseCmd === 'openclaw') && status === 'completed') {
            const cleaned = cleanAgentResponse(fullResponse);
            if (cleaned) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', text: cleaned }) + '\n'));
            }
          }
          if (code !== 0 || timedOut || interrupted) {
            const finalPayload = {
              type: 'error',
              message: interrupted
                ? interruptedReason
                : (timedOut ? `Process timed out after ${timeoutMs}ms` : `Process exited with code ${code}`)
            };
            controller.enqueue(encoder.encode(JSON.stringify(finalPayload) + '\n'));
          }
          controller.close();
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
          controller.enqueue(encoder.encode(JSON.stringify(errPayload) + '\n'));
          controller.close();
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
