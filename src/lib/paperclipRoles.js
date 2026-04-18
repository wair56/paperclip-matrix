export const PAPERCLIP_ALLOWED_AGENT_ROLES = [
  'ceo',
  'cto',
  'cmo',
  'cfo',
  'engineer',
  'designer',
  'pm',
  'qa',
  'devops',
  'researcher',
  'general',
];

export function isSupportedPaperclipRole(role) {
  return PAPERCLIP_ALLOWED_AGENT_ROLES.includes(String(role || '').trim());
}

export function getUnsupportedPaperclipRoleMessage(role) {
  return `Cloud currently only supports standard agent roles: ${PAPERCLIP_ALLOWED_AGENT_ROLES.join(', ')}. Unsupported role: ${role || '(empty)'}`;
}
