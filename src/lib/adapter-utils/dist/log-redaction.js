export const REDACTED_HOME_PATH_USER = "*";
function maskHomePathUserSegment(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return REDACTED_HOME_PATH_USER;
    return `${trimmed[0]}${"*".repeat(Math.max(1, Array.from(trimmed).length - 1))}`;
}
const HOME_PATH_PATTERNS = [
    {
        regex: /\/Users\/([^/\\\s]+)/g,
        replace: (_match, user) => `/Users/${maskHomePathUserSegment(user)}`,
    },
    {
        regex: /\/home\/([^/\\\s]+)/g,
        replace: (_match, user) => `/home/${maskHomePathUserSegment(user)}`,
    },
    {
        regex: /([A-Za-z]:\\Users\\)([^\\/\s]+)/g,
        replace: (_match, prefix, user) => `${prefix}${maskHomePathUserSegment(user)}`,
    },
];
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
export function redactHomePathUserSegments(text, opts) {
    if (opts?.enabled === false)
        return text;
    let result = text;
    for (const pattern of HOME_PATH_PATTERNS) {
        result = result.replace(pattern.regex, pattern.replace);
    }
    return result;
}
export function redactHomePathUserSegmentsInValue(value, opts) {
    if (typeof value === "string") {
        return redactHomePathUserSegments(value, opts);
    }
    if (Array.isArray(value)) {
        return value.map((entry) => redactHomePathUserSegmentsInValue(entry, opts));
    }
    if (!isPlainObject(value)) {
        return value;
    }
    const redacted = {};
    for (const [key, entry] of Object.entries(value)) {
        redacted[key] = redactHomePathUserSegmentsInValue(entry, opts);
    }
    return redacted;
}
export function redactTranscriptEntryPaths(entry, opts) {
    switch (entry.kind) {
        case "assistant":
        case "thinking":
        case "user":
        case "stderr":
        case "system":
        case "stdout":
            return { ...entry, text: redactHomePathUserSegments(entry.text, opts) };
        case "tool_call":
            return {
                ...entry,
                name: redactHomePathUserSegments(entry.name, opts),
                input: redactHomePathUserSegmentsInValue(entry.input, opts),
            };
        case "tool_result":
            return { ...entry, content: redactHomePathUserSegments(entry.content, opts) };
        case "init":
            return {
                ...entry,
                model: redactHomePathUserSegments(entry.model, opts),
                sessionId: redactHomePathUserSegments(entry.sessionId, opts),
            };
        case "result":
            return {
                ...entry,
                text: redactHomePathUserSegments(entry.text, opts),
                subtype: redactHomePathUserSegments(entry.subtype, opts),
                errors: entry.errors.map((error) => redactHomePathUserSegments(error, opts)),
            };
        default:
            return entry;
    }
}
//# sourceMappingURL=log-redaction.js.map