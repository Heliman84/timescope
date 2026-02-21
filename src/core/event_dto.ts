export interface EventDTO {
    id: string;
    event: "start" | "stop" | "pause" | "resume";
    job_title: string;
    timestamp: number; // Unix ms
    task?: string;
    job_id: string;
    time_seed: number;
}
