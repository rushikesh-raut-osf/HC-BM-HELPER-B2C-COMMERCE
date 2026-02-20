"use strict";

var ISML = require("dw/template/ISML");
var agentParser = require("*/cartridge/scripts/helpers/agentParser");
var agentPolicy = require("*/cartridge/scripts/helpers/agentPolicy");
var agentExecutor = require("*/cartridge/scripts/helpers/agentExecutor");
var agentAudit = require("*/cartridge/scripts/helpers/agentAudit");

function execute(pdict) {
    var method = request.httpMethod;
    var params = request.httpParameterMap;

    pdict.command = params.command ? params.command.stringValue : "";
    pdict.dryRun = params.dryRun ? params.dryRun.booleanValue : true;
    pdict.confirm = params.confirm ? params.confirm.booleanValue : false;
    pdict.intent = "";
    pdict.parsedParams = null;
    pdict.result = null;
    pdict.error = null;

    if (method === "POST" && pdict.command) {
        var parsed = agentParser.parse(pdict.command);
        if (!parsed || !parsed.intent) {
            pdict.error = "Could not parse command.";
        } else {
            pdict.intent = parsed.intent;
            pdict.parsedParams = parsed.params;

            var policyResult = agentPolicy.validate(parsed.intent, parsed.params);
            if (!policyResult.ok) {
                pdict.error = policyResult.error;
            } else {
                if (!pdict.dryRun && !pdict.confirm) {
                    pdict.error = "Non-dry-run requires confirm=true.";
                } else {
                    var execResult = agentExecutor.execute(parsed.intent, parsed.params, {
                        dryRun: pdict.dryRun,
                        confirm: pdict.confirm
                    });

                    agentAudit.log({
                        intent: parsed.intent,
                        params: parsed.params,
                        dryRun: pdict.dryRun,
                        success: execResult.success,
                        result: execResult.result,
                        error: execResult.error
                    });

                    if (!execResult.success) {
                        pdict.error = execResult.error || "Execution failed.";
                    } else {
                        pdict.result = execResult.result;
                    }
                }
            }
        }
    }

    pdict.resultJson = pdict.result ? JSON.stringify(pdict.result, null, 2) : "";
    pdict.parsedJson = pdict.parsedParams ? JSON.stringify(pdict.parsedParams, null, 2) : "";
    ISML.renderTemplate("agent/agentUI", pdict);

    return PIPELET_NEXT;
}

module.exports = {
    execute: execute
};
