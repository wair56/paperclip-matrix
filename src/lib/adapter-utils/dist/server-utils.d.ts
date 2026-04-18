import { type ChildProcess } from "node:child_process";
import type { AdapterSkillSnapshot } from "./types.js";
export interface RunProcessResult {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    pid: number | null;
    startedAt: string | null;
}
interface RunningProcess {
    child: ChildProcess;
    graceSec: number;
}
export declare const runningProcesses: Map<string, RunningProcess>;
export declare const MAX_CAPTURE_BYTES: number;
export declare const MAX_EXCERPT_BYTES: number;
export interface PaperclipSkillEntry {
    key: string;
    runtimeName: string;
    source: string;
    required?: boolean;
    requiredReason?: string | null;
}
export interface InstalledSkillTarget {
    targetPath: string | null;
    kind: "symlink" | "directory" | "file";
}
interface PersistentSkillSnapshotOptions {
    adapterType: string;
    availableEntries: PaperclipSkillEntry[];
    desiredSkills: string[];
    installed: Map<string, InstalledSkillTarget>;
    skillsHome: string;
    locationLabel?: string | null;
    installedDetail?: string | null;
    missingDetail: string;
    externalConflictDetail: string;
    externalDetail: string;
    warnings?: string[];
}
export declare function parseObject(value: unknown): Record<string, unknown>;
export declare function asString(value: unknown, fallback: string): string;
export declare function asNumber(value: unknown, fallback: number): number;
export declare function asBoolean(value: unknown, fallback: boolean): boolean;
export declare function asStringArray(value: unknown): string[];
export declare function parseJson(value: string): Record<string, unknown> | null;
export declare function appendWithCap(prev: string, chunk: string, cap?: number): string;
export declare function resolvePathValue(obj: Record<string, unknown>, dottedPath: string): string;
export declare function renderTemplate(template: string, data: Record<string, unknown>): string;
export declare function joinPromptSections(sections: Array<string | null | undefined>, separator?: string): string;
export declare function redactEnvForLogs(env: Record<string, string>): Record<string, string>;
export declare function buildInvocationEnvForLogs(env: Record<string, string>, options?: {
    runtimeEnv?: NodeJS.ProcessEnv | Record<string, string>;
    includeRuntimeKeys?: string[];
    resolvedCommand?: string | null;
    resolvedCommandEnvKey?: string;
}): Record<string, string>;
export declare function buildPaperclipEnv(agent: {
    id: string;
    companyId: string;
}): Record<string, string>;
export declare function defaultPathForPlatform(): "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem" | "/usr/local/bin:/opt/homebrew/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";
export declare function resolveCommandForLogs(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string>;
export declare function ensurePathInEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function ensureAbsoluteDirectory(cwd: string, opts?: {
    createIfMissing?: boolean;
}): Promise<void>;
export declare function resolvePaperclipSkillsDir(moduleDir: string, additionalCandidates?: string[]): Promise<string | null>;
export declare function listPaperclipSkillEntries(moduleDir: string, additionalCandidates?: string[]): Promise<PaperclipSkillEntry[]>;
export declare function readInstalledSkillTargets(skillsHome: string): Promise<Map<string, InstalledSkillTarget>>;
export declare function buildPersistentSkillSnapshot(options: PersistentSkillSnapshotOptions): AdapterSkillSnapshot;
export declare function readPaperclipRuntimeSkillEntries(config: Record<string, unknown>, moduleDir: string, additionalCandidates?: string[]): Promise<PaperclipSkillEntry[]>;
export declare function readPaperclipSkillMarkdown(moduleDir: string, skillKey: string): Promise<string | null>;
export declare function readPaperclipSkillSyncPreference(config: Record<string, unknown>): {
    explicit: boolean;
    desiredSkills: string[];
};
export declare function resolvePaperclipDesiredSkillNames(config: Record<string, unknown>, availableEntries: Array<{
    key: string;
    runtimeName?: string | null;
    required?: boolean;
}>): string[];
export declare function writePaperclipSkillSyncPreference(config: Record<string, unknown>, desiredSkills: string[]): Record<string, unknown>;
export declare function ensurePaperclipSkillSymlink(source: string, target: string, linkSkill?: (source: string, target: string) => Promise<void>): Promise<"created" | "repaired" | "skipped">;
export declare function removeMaintainerOnlySkillSymlinks(skillsHome: string, allowedSkillNames: Iterable<string>): Promise<string[]>;
export declare function renderPaperclipWakePrompt(value: unknown, options?: {
    resumedSession?: boolean;
}): string;
export declare function stringifyPaperclipWakePayload(value: unknown): string;
export declare function ensureCommandResolvable(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void>;
export declare function runChildProcess(runId: string, command: string, args: string[], opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
    graceSec: number;
    onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
    onLogError?: (err: unknown, runId: string, message: string) => void;
    onSpawn?: (meta: {
        pid: number;
        startedAt: string;
    }) => Promise<void>;
    stdin?: string;
}): Promise<RunProcessResult>;
export {};
//# sourceMappingURL=server-utils.d.ts.map
