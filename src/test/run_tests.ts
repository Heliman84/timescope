import { run_event_repository_append_and_load_tests, run_event_repository_rename_tests, run_event_repository_validation_tests, run_event_repository_last_sessions_tests, run_event_repository_dedupe_tests, run_event_repository_malformed_preservation_tests, run_event_repository_line_index_tests } from "./test_event_repository";
import { run_session_happy_path_tests, run_session_invalid_transition_tests, run_session_elapsed_open_segment_tests, run_session_equality_tests } from "./test_session";
import { run_event_collection_tests } from "./test_event_collection";
import { run_job_repository_tests } from "./test_jobs";

async function main() {
    try {
        run_event_repository_append_and_load_tests();
        run_event_repository_rename_tests();
        run_event_repository_validation_tests();
        run_event_repository_last_sessions_tests();
        run_event_repository_dedupe_tests();
        run_event_repository_malformed_preservation_tests();
        run_event_repository_line_index_tests();
        run_session_happy_path_tests();
        run_session_invalid_transition_tests();
        run_session_elapsed_open_segment_tests();
        run_session_equality_tests();
        run_event_collection_tests();
        await run_job_repository_tests();
        console.log("All tests passed.");
        process.exit(0);
    } catch (err) {
        console.error("Tests failed:", err);
        process.exit(1);
    }
}

main();
