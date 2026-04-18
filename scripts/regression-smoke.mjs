import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import getDb from "../src/lib/db.js";
import { GET as getRuns } from "../src/app/api/runs/route.js";
import { GET as getRunById, DELETE as deleteRunById } from "../src/app/api/runs/[id]/route.js";
import { POST as postWebhook } from "../src/app/api/webhook/paperclip/route.js";
import { POST as postWorker, DELETE as deleteWorker } from "../src/app/api/worker/route.js";
import { POST as postIdentity, PATCH as patchIdentity } from "../src/app/api/identity/route.js";
import { POST as postIdentitySync } from "../src/app/api/identity/sync/route.js";
import {
  registerRunningProcess,
  unregisterRunningProcess,
} from "../src/lib/runRegistry.js";
import { WORKSPACES_DIR } from "../src/lib/paths.js";
import { getNodeSettings, resolveCliRuntimeEnv, saveNodeSettings } from "../src/lib/nodeSettings.js";
import { SandboxManager } from "../src/lib/SandboxManager.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function testRunsHistory(db, prefix) {
  const companyId = `${prefix}-company`;
  const agentId = `${prefix}-agent-history`;
  const stmt = db.prepare(`
    INSERT INTO task_runs
      (id, runId, sourceEventId, taskId, companyId, agentId, role, prompt, response, receivedAt, repliedAt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < 31; i += 1) {
    stmt.run(
      `${prefix}-history-${i}`,
      `${prefix}-history-run-${i}`,
      `${prefix}-history-event-${i}`,
      `${prefix}-history-task-${i}`,
      companyId,
      agentId,
      `${prefix}-role-history`,
      `prompt-${i}`,
      `response-${i}`,
      Date.now() + i,
      Date.now() + i,
      "completed",
    );
  }

  const response = await getRuns(
    new Request(`http://localhost/api/runs?companyId=${companyId}&agentId=${agentId}&limit=30`),
  );
  const payload = await readJson(response);

  assert(payload?.success === true, "runs history API should succeed");
  assert(payload.runs.length === 30, `runs history should return 30 rows, got ${payload.runs.length}`);
  assert(payload.hasMore === true, "runs history should mark hasMore=true");
  assert(
    payload.runs[0]?.runId === `${prefix}-history-run-30`,
    "runs history should sort by receivedAt desc",
  );
}

async function testKillApi(db, prefix) {
  const runningId = `${prefix}-kill-row`;
  const runningRunId = `${prefix}-kill-run`;
  db.prepare(`
    INSERT INTO task_runs
      (id, runId, companyId, agentId, role, prompt, receivedAt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
  `).run(runningId, runningRunId, `${prefix}-company`, `${prefix}-agent-kill`, `${prefix}-role`, "kill test", Date.now());

  let killReason = null;
  registerRunningProcess(runningRunId, {
    requestKill(reason) {
      killReason = reason;
      return true;
    },
  });

  const deleteResponse = await deleteRunById(new Request("http://localhost/api/runs/test", { method: "DELETE" }), {
    params: Promise.resolve({ id: runningId }),
  });
  const deletePayload = await readJson(deleteResponse);
  unregisterRunningProcess(runningRunId);

  assert(deletePayload?.success === true, "kill API should succeed for running process");
  assert(killReason === "Killed by operator from task history", "kill API should pass operator reason");
  assert(
    db.prepare(`SELECT status FROM task_runs WHERE id = ?`).get(runningId)?.status === "interrupted",
    "kill API should mark DB row interrupted",
  );

  const staleId = `${prefix}-kill-stale-row`;
  const staleRunId = `${prefix}-kill-stale-run`;
  db.prepare(`
    INSERT INTO task_runs
      (id, runId, companyId, agentId, role, prompt, receivedAt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
  `).run(staleId, staleRunId, `${prefix}-company`, `${prefix}-agent-kill`, `${prefix}-role`, "stale kill test", Date.now());

  const staleResponse = await deleteRunById(new Request("http://localhost/api/runs/test", { method: "DELETE" }), {
    params: Promise.resolve({ id: staleId }),
  });
  const stalePayload = await readJson(staleResponse);
  const staleRow = db.prepare(`SELECT status, repliedAt FROM task_runs WHERE id = ?`).get(staleId);

  assert(stalePayload?.success === true, "kill API should recover stale running rows");
  assert(staleRow?.status === "interrupted", "stale running row should be marked interrupted");
  assert(Number.isFinite(staleRow?.repliedAt), "stale running row should get repliedAt");

  const getResponse = await getRunById(new Request("http://localhost/api/runs/test"), {
    params: Promise.resolve({ id: staleId }),
  });
  const getPayload = await readJson(getResponse);
  assert(getPayload?.success === true, "run detail API should succeed");
  assert(getPayload?.run?.id === staleId, "run detail API should return requested row");
}

async function testWebhookDedup(db, prefix) {
  const role = `${prefix}-role-webhook`;
  const agentId = `${prefix}-agent-webhook`;
  const companyId = `${prefix}-company-webhook`;
  const issueId = `${prefix}-issue-webhook`;
  const runId = `${prefix}-webhook-run`;
  const sourceEventId = `${prefix}-webhook-comment`;
  const apiUrl = "https://smoke.paperclip.local";

  db.prepare(`
    INSERT OR REPLACE INTO identities
      (role, name, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, envJson, status, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
  `).run(
    role,
    `${role}-name`,
    agentId,
    apiUrl,
    companyId,
    "true-local",
    null,
    5000,
    "smoke-key",
    JSON.stringify({ RUNNER_SKIP_PERMISSIONS: "true" }),
  );

  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = (options.method || "GET").toUpperCase();
    let body = null;
    if (typeof options.body === "string" && options.body.length > 0) {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = options.body;
      }
    }
    fetchCalls.push({ url: href, method, body });

    if (href.endsWith(`/api/issues/${issueId}/comments`) && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.endsWith(`/api/issues/${issueId}/comments`) && method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.endsWith(`/api/runs/${runId}/reply`) && method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.endsWith(`/api/issues/${issueId}`) && method === "PATCH") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in smoke test: ${method} ${href}`);
  };

  try {
    const firstResponse = await postWebhook(
      new Request("http://localhost/api/webhook/paperclip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          agentId,
          companyId,
          replyTransport: "callback",
          autoCloseIssue: true,
          context: {
            issueId,
            taskId: issueId,
            commentId: sourceEventId,
            paperclipWake: {
              latestCommentId: sourceEventId,
            },
          },
        }),
      }),
    );
    await firstResponse.text();

    const firstRun = db.prepare(`SELECT status, response, sourceEventId FROM task_runs WHERE runId = ?`).get(runId);
    assert(firstRun?.status === "completed", `webhook run should complete, got ${firstRun?.status}`);
    assert(firstRun?.sourceEventId === sourceEventId, "webhook run should persist sourceEventId");

    const firstReplyCalls = fetchCalls.filter((call) => call.url.endsWith(`/api/runs/${runId}/reply`));
    const firstCommentGets = fetchCalls.filter(
      (call) => call.url.endsWith(`/api/issues/${issueId}/comments`) && call.method === "GET",
    );
    const firstCommentPosts = fetchCalls.filter(
      (call) => call.url.endsWith(`/api/issues/${issueId}/comments`) && call.method === "POST",
    );
    const firstIssuePatches = fetchCalls.filter(
      (call) => call.url.endsWith(`/api/issues/${issueId}`) && call.method === "PATCH",
    );

    assert(firstReplyCalls.length === 1, `expected 1 callback reply, got ${firstReplyCalls.length}`);
    assert(firstCommentGets.length === 1, `expected 1 issue comment list call, got ${firstCommentGets.length}`);
    assert(firstCommentPosts.length === 1, `expected 1 issue comment post, got ${firstCommentPosts.length}`);
    assert(firstIssuePatches.length === 0, "empty response should not auto-close issue");

    const duplicateRunResponse = await postWebhook(
      new Request("http://localhost/api/webhook/paperclip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          agentId,
          companyId,
          replyTransport: "callback",
          context: {
            issueId,
            taskId: issueId,
            commentId: sourceEventId,
          },
        }),
      }),
    );
    const duplicateRunPayload = await readJson(duplicateRunResponse);
    assert(duplicateRunPayload?.success === true, "duplicate runId delivery should short-circuit successfully");
    assert(
      String(duplicateRunPayload?.message || "").includes("already"),
      "duplicate runId delivery should report already processed",
    );

    const duplicateEventResponse = await postWebhook(
      new Request("http://localhost/api/webhook/paperclip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: `${runId}-2`,
          agentId,
          companyId,
          replyTransport: "callback",
          context: {
            issueId,
            taskId: issueId,
            commentId: sourceEventId,
          },
        }),
      }),
    );
    const duplicateEventPayload = await readJson(duplicateEventResponse);
    assert(duplicateEventPayload?.success === true, "duplicate sourceEventId delivery should short-circuit");
    assert(
      String(duplicateEventPayload?.message || "").includes("already"),
      "duplicate sourceEventId delivery should report already processed",
    );

    const totalReplyCalls = fetchCalls.filter((call) => call.url.endsWith(`/api/runs/${runId}/reply`));
    const totalCommentPosts = fetchCalls.filter(
      (call) => call.url.endsWith(`/api/issues/${issueId}/comments`) && call.method === "POST",
    );
    assert(totalReplyCalls.length === 1, "duplicate webhook deliveries must not send repeated callback replies");
    assert(totalCommentPosts.length === 1, "duplicate webhook deliveries must not post repeated issue comments");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const workspacePath = path.join(WORKSPACES_DIR, agentId);
  if (existsSync(workspacePath)) {
    rmSync(workspacePath, { recursive: true, force: true });
  }
}

async function testIdentityProvisionAndPatch(db, prefix) {
  const companyId = `${prefix}-company-identity`;
  const apiUrl = "https://identity.paperclip.local";
  db.prepare(`
    INSERT OR REPLACE INTO companies
      (id, name, apiUrl, boardKey, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(companyId, `${prefix}-company`, apiUrl, "board-key");

  const originalSettings = getNodeSettings();
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = (options.method || "GET").toUpperCase();
    const body = typeof options.body === "string" && options.body.length > 0
      ? JSON.parse(options.body)
      : null;
    fetchCalls.push({ url: href, method, body });

    if (href === `${apiUrl}/api/companies/${companyId}/agents` && method === "POST") {
      return new Response(JSON.stringify({ id: `${prefix}-remote-agent` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href === `${apiUrl}/api/agents/${prefix}-remote-agent/keys` && method === "POST") {
      return new Response(JSON.stringify({ key: `${prefix}-api-key` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href === `${apiUrl}/api/agents/${prefix}-remote-agent` && method === "PATCH") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in identity smoke test: ${method} ${href}`);
  };

  try {
    saveNodeSettings({
      ...originalSettings,
      frp: { ...originalSettings.frp, serverAddr: "", remotePort: 50002 },
    });

    const createResponse = await postIdentity(
      new Request("http://localhost/api/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          roleName: "general",
          name: `${prefix}-General`,
          executor: "opencode-local",
          model: "gpt-5.4",
          initialSoul: "test soul",
        }),
      }),
    );
    const createPayload = await readJson(createResponse);
    assert(createPayload?.success === true, "identity create should succeed");
    assert(createPayload?.agentId === `${prefix}-remote-agent`, "identity create should return remote agent id");

    const createAgentCall = fetchCalls.find((call) => call.url.endsWith(`/api/companies/${companyId}/agents`));
    assert(createAgentCall?.body?.adapterType === "opencode_local", "identity create should map executor to adapter type");
    assert(
      createAgentCall?.body?.adapterConfig?.model === "openai/gpt-5.4",
      "identity create should normalize OpenCode model names",
    );
    assert(
      db.prepare(`SELECT executor, model, apiKey FROM identities WHERE role = 'general' AND agentId = ?`).get(`${prefix}-remote-agent`)?.model === "gpt-5.4",
      "identity create should persist local model",
    );

    fetchCalls.length = 0;
    const patchResponse = await patchIdentity(
      new Request("http://localhost/api/identity", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "general",
          executor: "codex-local",
          model: "gpt-5.4",
          name: `${prefix}-Renamed`,
        }),
      }),
    );
    const patchPayload = await readJson(patchResponse);
    assert(patchPayload?.success === true, "identity patch should succeed");

    const patchCall = fetchCalls.find((call) => call.url.endsWith(`/api/agents/${prefix}-remote-agent`) && call.method === "PATCH");
    assert(patchCall, "identity patch should sync to cloud");
    assert(patchCall.body?.adapterType === "codex_local", "identity patch should sync adapter type");
    assert(patchCall.body?.adapterConfig?.model === "gpt-5.4", "identity patch should sync model");

    const envPatchResponse = await patchIdentity(
      new Request("http://localhost/api/identity", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "general",
          envText: `CODEX_API_KEY=${prefix}-codex\nFEATURE_FLAG=1`,
        }),
      }),
    );
    const envPatchPayload = await readJson(envPatchResponse);
    assert(envPatchPayload?.success === true, "identity patch should accept local env text");
    const envRow = db.prepare(`SELECT envJson, localEnvJson FROM identities WHERE role = 'general'`).get();
    assert(JSON.parse(envRow?.localEnvJson || "{}")?.CODEX_API_KEY === `${prefix}-codex`, "identity patch should persist localEnvJson");
    assert(JSON.parse(envRow?.envJson || "{}")?.FEATURE_FLAG === "1", "identity patch should keep merged envJson in sync");

    saveNodeSettings({
      ...originalSettings,
      frp: { ...originalSettings.frp, serverAddr: "frp.example.com", remotePort: 19000 },
    });
    fetchCalls.length = 0;

    const frpRole = "qa";
    const frpResponse = await postIdentity(
      new Request("http://localhost/api/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          roleName: frpRole,
          name: `${prefix}-QA`,
          executor: "codex-local",
          model: "gpt-5.4",
        }),
      }),
    );
    const frpPayload = await readJson(frpResponse);
    assert(frpPayload?.success === true, "identity create with FRP should succeed");
    const frpCreateCall = fetchCalls.find((call) => call.url.endsWith(`/api/companies/${companyId}/agents`) && call.method === "POST");
    assert(frpCreateCall?.body?.adapterType === "http", "identity create should switch to http adapter when FRP is configured");
    assert(
      frpCreateCall?.body?.adapterConfig?.url === "http://frp.example.com:19000/api/webhook/paperclip",
      "identity create should publish webhook URL through FRP",
    );
    assert(
      frpCreateCall?.body?.adapterConfig?.model === "gpt-5.4",
      "identity create should retain model in FRP mode",
    );
  } finally {
    saveNodeSettings(originalSettings);
    globalThis.fetch = originalFetch;
  }
}

async function testIdentitySync(db, prefix) {
  const companyId = `${prefix}-company-sync`;
  const apiUrl = "https://sync.paperclip.local";
  const boardKey = `${prefix}-board`;
  db.prepare(`
    INSERT OR REPLACE INTO companies
      (id, name, apiUrl, boardKey, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(companyId, `${prefix}-sync-company`, apiUrl, boardKey);

  db.prepare(`
    INSERT OR REPLACE INTO identities
      (role, name, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, envJson, status, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
  `).run(
    `${prefix}-local-retire`,
    "retire me",
    `${prefix}-remote-deleted`,
    apiUrl,
    companyId,
    "claude-local",
    "old-model",
    1800000,
    "key",
    "{}",
  );
  db.prepare(`
    INSERT OR REPLACE INTO identities
      (role, name, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, envJson, status, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
  `).run(
    `${prefix}-local-update`,
    "old name",
    `${prefix}-remote-existing`,
    apiUrl,
    companyId,
    "claude-local",
    "old-model",
    1800000,
    "key",
    "{}",
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href === `${apiUrl}/api/companies/${companyId}/agents`) {
      return new Response(JSON.stringify({
        data: [
          {
            id: `${prefix}-remote-existing`,
            name: "updated name",
            role: "general",
            adapterType: "codex_local",
            adapterConfig: { model: "gpt-5.4" },
          },
          {
            id: `${prefix}-remote-new`,
            name: "new remote",
            role: "engineer",
            adapterType: "http",
            adapterConfig: { model: "gpt-5.4" },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (/\/api\/companies\/[^/]+\/agents$/.test(href)) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href === `${apiUrl}/api/agents/${prefix}-remote-deleted`) {
      return new Response("missing", { status: 404 });
    }
    if (href === `${apiUrl}/api/agents/${prefix}-remote-existing`) {
      return new Response(JSON.stringify({ id: `${prefix}-remote-existing` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (/\/api\/agents\/[^/]+$/.test(href)) {
      return new Response(JSON.stringify({ id: "other-agent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in identity sync smoke test: ${href}`);
  };

  try {
    const response = await postIdentitySync(
      new Request("http://localhost/api/identity/sync", { method: "POST" }),
    );
    const payload = await readJson(response);
    assert(payload?.success === true, "identity sync should succeed");
    assert(payload?.retiredCount === 1, `identity sync should retire exactly 1 agent, got ${payload?.retiredCount}`);
    assert(payload?.provisionedCount === 1, `identity sync should provision exactly 1 agent, got ${payload?.provisionedCount}`);

    const retiredRow = db.prepare(`SELECT status FROM identities WHERE role = ?`).get(`${prefix}-local-retire`);
    assert(retiredRow?.status === "retired", "identity sync should retire missing remote agent");

    const updatedRow = db.prepare(`SELECT name, executor, model FROM identities WHERE agentId = ?`).get(`${prefix}-remote-existing`);
    assert(updatedRow?.name === "updated name", "identity sync should refresh local agent name");
    assert(updatedRow?.executor === "codex-local", "identity sync should map remote adapter type back to local executor");
    assert(updatedRow?.model === "gpt-5.4", "identity sync should refresh local model");

    const newRow = db.prepare(`SELECT role, executor, model, apiKey FROM identities WHERE agentId = ?`).get(`${prefix}-remote-new`);
    assert(newRow?.role === "engineer", "identity sync should provision using remote role when available");
    assert(newRow?.executor === "claude-local", "identity sync should fall back to claude-local for http agents");
    assert(newRow?.model === "gpt-5.4", "identity sync should persist remote model for newly provisioned agents");
    assert(newRow?.apiKey === boardKey, "identity sync should use board key as fallback api key");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testWorkerSync(db, prefix) {
  const role = `${prefix}-worker-role`;
  const agentId = `${prefix}-worker-agent`;
  const companyId = `${prefix}-worker-company`;
  const apiUrl = "https://worker.paperclip.local";
  const boardKey = `${prefix}-board-key`;
  db.prepare(`
    INSERT OR REPLACE INTO companies
      (id, name, apiUrl, boardKey, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(companyId, `${prefix}-worker-company`, apiUrl, boardKey);

  db.prepare(`
    INSERT OR REPLACE INTO identities
      (role, name, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, envJson, status, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
  `).run(
    role,
    "worker name",
    agentId,
    apiUrl,
    companyId,
    "codex-local",
    "gpt-5.4",
    1800000,
    `${prefix}-identity-key`,
    JSON.stringify({ CUSTOM_ENV: "local", RUNNER_SKIP_PERMISSIONS: "true" }),
  );

  const originalSettings = getNodeSettings();
  saveNodeSettings({
    ...originalSettings,
    frp: { ...originalSettings.frp, serverAddr: "frp.worker.local", remotePort: 20001 },
  });

  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = (options.method || "GET").toUpperCase();
    const body = typeof options.body === "string" && options.body.length > 0
      ? JSON.parse(options.body)
      : null;
    fetchCalls.push({ url: href, method, body, headers: options.headers || {} });

    if (href === `${apiUrl}/api/agents/${agentId}` && method === "GET") {
      return new Response(JSON.stringify({
        data: {
          id: agentId,
          name: "worker remote name",
          runtimeConfig: { CLOUD_SECRET: "abc123" },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href === `${apiUrl}/api/agents/${agentId}` && method === "PATCH") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in worker smoke test: ${method} ${href}`);
  };

  try {
    const postResponse = await postWorker(
      new Request("http://localhost/api/worker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    );
    const postPayload = await readJson(postResponse);
    assert(postPayload?.success === true, "worker ignite should succeed");

    const getCall = fetchCalls.find((call) => call.url === `${apiUrl}/api/agents/${agentId}` && call.method === "GET");
    const patchCall = fetchCalls.find((call) => call.url === `${apiUrl}/api/agents/${agentId}` && call.method === "PATCH");
    assert(getCall, "worker ignite should fetch latest cloud agent data");
    assert(patchCall, "worker ignite should patch cloud agent adapter");
    assert(patchCall.body?.adapterType === "http", "worker ignite should switch cloud adapter to webhook/http when FRP is configured");
    assert(
      patchCall.body?.adapterConfig?.url === "http://frp.worker.local:20001/api/webhook/paperclip",
      "worker ignite should publish the FRP webhook URL",
    );
    assert(
      patchCall.body?.adapterConfig?.model === "gpt-5.4",
      "worker ignite should sync the locally selected model",
    );

    const workerRow = db.prepare(`SELECT isActive, name, envJson, localEnvJson, cloudEnvJson FROM identities WHERE role = ?`).get(role);
    assert(workerRow?.isActive === 1, "worker ignite should persist isActive=1");
    assert(workerRow?.name === "worker remote name", "worker ignite should refresh local name from cloud");
    assert(JSON.parse(workerRow?.envJson || "{}")?.CLOUD_SECRET === "abc123", "worker ignite should persist runtimeConfig from cloud");
    assert(JSON.parse(workerRow?.envJson || "{}")?.CUSTOM_ENV === "local", "worker ignite should preserve local env overrides while merging cloud runtimeConfig");
    assert(JSON.parse(workerRow?.cloudEnvJson || "{}")?.CLOUD_SECRET === "abc123", "worker ignite should store cloud runtime config separately");
    assert(JSON.parse(workerRow?.localEnvJson || "{}")?.CUSTOM_ENV === "local", "worker ignite should preserve local env overrides separately");
    assert(globalThis.__matrixActiveWorkers?.has(role), "worker ignite should register active worker in memory");

    const deleteResponse = await deleteWorker(
      new Request("http://localhost/api/worker", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    );
    const deletePayload = await readJson(deleteResponse);
    assert(deletePayload?.success === true, "worker delete should succeed");
    assert(db.prepare(`SELECT isActive FROM identities WHERE role = ?`).get(role)?.isActive === 0, "worker delete should clear isActive");
    assert(!globalThis.__matrixActiveWorkers?.has(role), "worker delete should clear active worker map");
  } finally {
    saveNodeSettings(originalSettings);
    globalThis.fetch = originalFetch;
  }
}

async function testGlobalCliRuntimeEnv(db, prefix) {
  const role = `${prefix}-role-runtime-env`;
  db.prepare(`
    INSERT OR REPLACE INTO identities
      (role, name, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, envJson, status, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
  `).run(
    role,
    "runtime env worker",
    `${prefix}-agent-runtime-env`,
    "https://runtime.paperclip.local",
    `${prefix}-company-runtime-env`,
    "codex-local",
    "gpt-5.4",
    1800000,
    `${prefix}-api-key`,
    JSON.stringify({ IDENTITY_ONLY: "yes" }),
  );

  const originalSettings = getNodeSettings();
  saveNodeSettings({
    ...originalSettings,
    proxy: { ...originalSettings.proxy, httpsProxy: "http://127.0.0.1:18888", openaiBaseUrl: "https://example.invalid/v1" },
    cli: {
      ...(originalSettings.cli || {}),
      envText: `CODEX_API_KEY=${prefix}-codex-key\nGLOBAL_ONLY=${prefix}-global`,
    },
  });

  try {
    const resolvedRuntimeEnv = resolveCliRuntimeEnv(getNodeSettings());
    assert(resolvedRuntimeEnv.CODEX_API_KEY === `${prefix}-codex-key`, "runtime env should parse CODEX_API_KEY from node settings");
    assert(resolvedRuntimeEnv.GLOBAL_ONLY === `${prefix}-global`, "runtime env should parse GLOBAL_ONLY from node settings");

    const sandbox = SandboxManager.getExecutionPayload(role);
    assert(sandbox.env.CODEX_API_KEY === `${prefix}-codex-key`, "sandbox should inject global CODEX_API_KEY");
    assert(sandbox.env.GLOBAL_ONLY === `${prefix}-global`, "sandbox should inject global runtime env");
    assert(sandbox.env.IDENTITY_ONLY === "yes", "sandbox should preserve identity-specific env");
    assert(sandbox.env.HTTPS_PROXY === "http://127.0.0.1:18888", "sandbox should inject global HTTPS proxy");
    assert(sandbox.env.OPENAI_BASE_URL === "https://example.invalid/v1", "sandbox should inject global OPENAI_BASE_URL");
  } finally {
    saveNodeSettings(originalSettings);
  }
}

async function main() {
  const db = getDb();
  const prefix = `smoke-${randomUUID()}`;

  try {
    await testRunsHistory(db, prefix);
    await testKillApi(db, prefix);
    await testWebhookDedup(db, prefix);
    await testIdentityProvisionAndPatch(db, prefix);
    await testIdentitySync(db, prefix);
    await testWorkerSync(db, prefix);
    await testGlobalCliRuntimeEnv(db, prefix);
    console.log("SMOKE_OK");
  } finally {
    unregisterRunningProcess(`${prefix}-kill-run`);
    globalThis.__matrixActiveWorkers?.clear?.();
    db.prepare(`DELETE FROM task_runs WHERE id LIKE ? OR runId LIKE ? OR agentId LIKE ? OR companyId LIKE ? OR role LIKE ?`)
      .run(`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`);
    db.prepare(`DELETE FROM identities WHERE role LIKE ? OR agentId LIKE ? OR companyId LIKE ?`)
      .run(`${prefix}%`, `${prefix}%`, `${prefix}%`);
    db.prepare(`DELETE FROM companies WHERE id LIKE ? OR name LIKE ?`).run(`${prefix}%`, `${prefix}%`);
  }
}

await main();
