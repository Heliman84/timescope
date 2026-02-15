import { run_logs_tests } from "./test_logs";
import { run_jobs_tests } from "./test_jobs";
import { run_update_log_tests } from "./test_update_log";
import { run_update_session_tests } from "./test_update_session";
import { run_event_collection_tests } from "./test_event_collection";
import { run_rename_roundtrip_test } from "./test_rename_roundtrip";
import { run_logs_header_and_event_parse } from "./test_logs";
import { run_dashboard_controller_error_scoping_test } from "./test_update_log";

function main() {
    try {
        run_logs_tests();
        run_jobs_tests();
        run_update_log_tests();
        run_update_session_tests();
        run_event_collection_tests();
        run_rename_roundtrip_test();
        run_logs_header_and_event_parse();
        run_dashboard_controller_error_scoping_test();
        console.log("All tests passed.");
        process.exit(0);
    } catch (err) {
        console.error("Tests failed:", err);
        process.exit(1);
    }
}

main();
