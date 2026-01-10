export type Event = 'start' | 'pause' | 'resume' | 'stop';

export interface StartPauseResumeRecord {
    event: 'start' | 'pause' | 'resume';
    job: string;
    timestamp: number;
}

export interface StopRecord {
    event: 'stop';
    job: string;
    timestamp: number;
    task?: string;
}

export type LogRecord = StartPauseResumeRecord | StopRecord;

export interface LogEntry {
    record: LogRecord;
    raw: string;
    source: "global" | "workspace";
    lineIndex: number;
}
