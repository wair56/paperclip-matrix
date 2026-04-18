export function buildWebhookInvocation({ family, prompt, modelArg = null, skipPermissions = true }) {
  let args = [];
  let sendPromptToStdin = Boolean(prompt);

  if (family === 'hermes') {
    args = ['chat', '--quiet', '--yolo', '-q', prompt];
    sendPromptToStdin = false;
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'claude') {
    args = ['--print', '-', '--output-format', 'json', '--verbose'];
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    args.push('--no-session-persistence');
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'codex') {
    args = ['exec', '-', '--json'];
    if (skipPermissions) args.push('--dangerously-bypass-approvals-and-sandbox');
    args.push('--skip-git-repo-check', '--ephemeral');
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'gemini') {
    args = ['-p', '-', '-o', 'stream-json'];
    if (skipPermissions) args.push('-y');
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'opencode') {
    args = ['run', prompt, '--format', 'json'];
    sendPromptToStdin = false;
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'cursor') {
    args = ['-p', '--output-format', 'stream-json'];
    if (modelArg) args.push('--model', modelArg);
    if (skipPermissions) args.push('--yolo');
  } else if (family === 'pi') {
    args = ['-p', prompt];
    sendPromptToStdin = false;
    if (modelArg?.includes('/')) {
      const [provider, model] = modelArg.split('/', 2);
      args.push('--provider', provider, '--model', model);
    } else if (modelArg) {
      args.push('--model', modelArg);
    }
  } else if (family === 'openclaw') {
    args = ['agent', '--message', prompt, '--json'];
    sendPromptToStdin = false;
  } else {
    if (modelArg) args.push('--model', modelArg);
  }

  return { args, sendPromptToStdin };
}

export function buildIdentityTestInvocation({ family, prompt, modelArg = null }) {
  let args = [];

  if (family === 'hermes') {
    args = ['chat', '--yolo', '--max-turns', '2', '--source', 'tool'];
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'claude') {
    args = ['--print', '-', '--dangerously-skip-permissions', '--no-session-persistence'];
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'codex') {
    args = ['exec', '-', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--ephemeral'];
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'gemini') {
    args = ['-p', prompt, '-y'];
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'opencode') {
    args = ['run', prompt, '--format', 'json', '--dangerously-skip-permissions'];
    if (modelArg) args.push('--model', modelArg);
  } else if (family === 'pi') {
    args = ['-p', prompt];
    if (modelArg?.includes('/')) {
      const [provider, model] = modelArg.split('/', 2);
      args.push('--provider', provider, '--model', model);
    } else if (modelArg) {
      args.push('--model', modelArg);
    }
  } else if (family === 'cursor') {
    args = ['-p', '--output-format', 'stream-json'];
    if (modelArg) args.push('--model', modelArg);
  } else {
    args = ['chat', '--yolo', '--max-turns', '2'];
    if (modelArg) args.push('--model', modelArg);
  }

  return { args };
}
