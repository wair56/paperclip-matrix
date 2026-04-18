import { existsSync } from 'fs';
import path from 'path';
import getDb from './db';
import { WORKSPACES_DIR } from './paths';

export function getWorkspaceCandidatesForIdentity(identity) {
  const candidates = [];
  if (identity?.agentId) candidates.push(path.join(WORKSPACES_DIR, identity.agentId));
  if (identity?.role) candidates.push(path.join(WORKSPACES_DIR, identity.role));
  return [...new Set(candidates)];
}

export function getPrimaryWorkspacePathForIdentity(identity) {
  return getWorkspaceCandidatesForIdentity(identity)[0] || path.join(WORKSPACES_DIR, 'unknown');
}

export function getExistingWorkspacePathForIdentity(identity) {
  const candidates = getWorkspaceCandidatesForIdentity(identity);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function getWorkspacePathForRole(role) {
  const db = getDb();
  const identity = db.prepare(`SELECT role, agentId FROM identities WHERE role = ?`).get(role);
  if (!identity) {
    return path.join(WORKSPACES_DIR, role);
  }
  return getExistingWorkspacePathForIdentity(identity) || getPrimaryWorkspacePathForIdentity(identity);
}
