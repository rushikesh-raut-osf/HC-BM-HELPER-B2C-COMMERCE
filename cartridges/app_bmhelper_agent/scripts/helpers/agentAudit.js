"use strict";

var Logger = require("dw/system/Logger");
var logger = Logger.getLogger("Agent");

function log(entry) {
    try {
        logger.info("intent={0} dryRun={1} success={2} params={3} error={4}",
            entry.intent,
            entry.dryRun,
            entry.success,
            JSON.stringify(entry.params || {}),
            entry.error || ""
        );
    } catch (e) {
        logger.error("Agent audit log error: {0}", e.message);
    }
}

module.exports = {
    log: log
};
