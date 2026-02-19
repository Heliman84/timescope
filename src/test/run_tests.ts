import { run_event_repository_basic_tests, run_event_repository_rename_tests } from "./test_logs";
import { run_event_repository_validation_tests } from "./test_update_log";
import { run_session_happy_path_tests, run_session_invalid_transition_tests, run_session_elapsed_open_segment_tests, run_session_equality_tests } from "./test_session";
import { run_event_collection_tests } from "./test_event_collection";
import { run_rename_roundtrip_test } from "./test_rename_roundtrip";
import { run_job_repository_tests } from "./test_jobs";

async function main() {
    try {
        run_event_repository_basic_tests();
        run_event_repository_rename_tests();
        run_event_repository_validation_tests();
        run_session_happy_path_tests();
        run_session_invalid_transition_tests();
        run_session_elapsed_open_segment_tests();
        run_session_equality_tests();
        run_event_collection_tests();
        run_rename_roundtrip_test();
        await run_job_repository_tests();
        console.log("All tests passed.");
        process.exit(0);
    } catch (err) {
        console.error("Tests failed:", err);
        process.exit(1);
    }
}

main();
