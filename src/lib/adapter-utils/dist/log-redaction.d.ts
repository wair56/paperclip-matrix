import type { TranscriptEntry } from "./types.js";
export declare const REDACTED_HOME_PATH_USER = "*";
export interface HomePathRedactionOptions {
    enabled?: boolean;
}
export declare function redactHomePathUserSegments(text: string, opts?: HomePathRedactionOptions): string;
export declare function redactHomePathUserSegmentsInValue<T>(value: T, opts?: HomePathRedactionOptions): T;
export declare function redactTranscriptEntryPaths(entry: TranscriptEntry, opts?: HomePathRedactionOptions): TranscriptEntry;
//# sourceMappingURL=log-redaction.d.ts.map