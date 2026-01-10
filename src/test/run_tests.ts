import { run_logs_tests } from "./test_logs";
import { run_jobs_tests } from "./test_jobs";
import { run_update_log_tests } from "./test_update_log";
import { run_update_session_tests } from "./test_update_session";

function main() {
    try {
        run_logs_tests();
        run_jobs_tests();
        run_update_log_tests();
        run_update_session_tests();
        console.log("All tests passed.");
        process.exit(0);
    } catch (err) {
        console.error("Tests failed:", err);
        process.exit(1);
    }
}

main();
