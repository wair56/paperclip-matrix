import { execFileSync, spawnSync } from "node:child_process";

import { buildIdentityTestInvocation, buildWebhookInvocation } from "../src/lib/cliInvocation.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasCommand(binary) {
  try {
    execFileSync("sh", ["-lc", `command -v ${binary}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function readHelp(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: "utf-8",
    stdio: "pipe",
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${binary} ${args.join(" ")} exited with ${result.status}`);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

const CASES = [
  {
    name: "claude-local",
    binary: "claude",
    helpArgs: ["--help"],
    tokens: ["--print", "--output-format", "--verbose", "--dangerously-skip-permissions", "--model"],
    webhook: buildWebhookInvocation({
      family: "claude",
      prompt: "hello",
      modelArg: "claude-sonnet-4-6",
      skipPermissions: true,
    }).args,
    test: buildIdentityTestInvocation({
      family: "claude",
      prompt: "hello",
      modelArg: "claude-sonnet-4-6",
    }).args,
  },
  {
    name: "codex-local",
    binary: "codex",
    helpArgs: ["exec", "--help"],
    tokens: ["--json", "--dangerously-bypass-approvals-and-sandbox", "--model"],
    webhook: buildWebhookInvocation({
      family: "codex",
      prompt: "hello",
      modelArg: "gpt-5.4",
      skipPermissions: true,
    }).args,
    test: buildIdentityTestInvocation({
      family: "codex",
      prompt: "hello",
      modelArg: "gpt-5.4",
    }).args,
  },
  {
    name: "hermes-local",
    binary: "hermes",
    helpArgs: ["chat", "--help"],
    tokens: ["--quiet", "--query", "--yolo", "--max-turns", "--source", "--model"],
    webhook: buildWebhookInvocation({
      family: "hermes",
      prompt: "hello",
      modelArg: "gpt-5.4",
      skipPermissions: true,
    }).args,
    test: buildIdentityTestInvocation({
      family: "hermes",
      prompt: "hello",
      modelArg: "gpt-5.4",
    }).args,
  },
  {
    name: "gemini-local",
    binary: "gemini",
    helpArgs: ["--help"],
    tokens: ["--prompt", "--output-format", "--yolo", "--model"],
    webhook: buildWebhookInvocation({
      family: "gemini",
      prompt: "hello",
      modelArg: "gemini-2.5-pro",
      skipPermissions: true,
    }).args,
    test: buildIdentityTestInvocation({
      family: "gemini",
      prompt: "hello",
      modelArg: "gemini-2.5-pro",
    }).args,
  },
  {
    name: "opencode-local",
    binary: "opencode",
    helpArgs: ["run", "--help"],
    tokens: ["--format", "--dangerously-skip-permissions", "--model"],
    webhook: buildWebhookInvocation({
      family: "opencode",
      prompt: "hello",
      modelArg: "openai/gpt-5.4",
      skipPermissions: true,
    }).args,
    test: buildIdentityTestInvocation({
      family: "opencode",
      prompt: "hello",
      modelArg: "openai/gpt-5.4",
    }).args,
  },
];

const skipped = [];
for (const testCase of CASES) {
  if (!hasCommand(testCase.binary)) {
    skipped.push(testCase.name);
    continue;
  }

  const helpText = readHelp(testCase.binary, testCase.helpArgs);
  for (const token of testCase.tokens) {
    assert(
      helpText.includes(token),
      `${testCase.name}: installed CLI help is missing expected token ${token}`,
    );
  }

  for (const token of testCase.webhook.filter((value) => String(value).startsWith("-"))) {
    const normalized = token === "-q"
      ? "--query"
      : token === "-p"
        ? "--prompt"
        : token === "-o"
          ? "--output-format"
          : token;
    assert(
      helpText.includes(normalized) || helpText.includes(token),
      `${testCase.name}: webhook args use unsupported flag ${token}`,
    );
  }

  for (const token of testCase.test.filter((value) => String(value).startsWith("-"))) {
    const normalized = token === "-q"
      ? "--query"
      : token === "-p"
        ? "--prompt"
        : token === "-o"
          ? "--output-format"
          : token;
    assert(
      helpText.includes(normalized) || helpText.includes(token),
      `${testCase.name}: identity test args use unsupported flag ${token}`,
    );
  }
}

console.log(JSON.stringify({ ok: true, skipped }, null, 2));
