"use strict";

/**
 * Agent API (MVP)
 * POST /Agent-Command
 *
 * Body:
 * {
 *   "command": "create 20% off on jackets this weekend",
 *   "intent": "CreatePromotion",          // optional (bypasses parser)
 *   "params": { ... },                    // optional (bypasses parser)
 *   "dryRun": true,                       // default true
 *   "confirm": false                      // required for non-dry run
 * }
 */

var server = require("server");
var Site = require("dw/system/Site");
var agentParser = require("*/cartridge/scripts/helpers/agentParser");
var agentPolicy = require("*/cartridge/scripts/helpers/agentPolicy");
var agentExecutor = require("*/cartridge/scripts/helpers/agentExecutor");
var agentAudit = require("*/cartridge/scripts/helpers/agentAudit");

server.post("Command", function (req, res, next) {
    try {
        var accessKey = Site.getCurrent().getCustomPreferenceValue("AgentAccessKey");
        var apiKey = req.httpHeaders.get("x-api-key");

        if (!accessKey || apiKey !== accessKey) {
            res.json({ success: false, error: "Unauthorized request." });
            return next();
        }

        var body = req.body ? JSON.parse(req.body) : null;
        if (!body) {
            res.json({ success: false, error: "Invalid request body." });
            return next();
        }

        var dryRun = body.dryRun !== false;
        var confirm = body.confirm === true;

        if (!dryRun && !confirm) {
            res.json({ success: false, error: "Non-dry-run requires confirm=true." });
            return next();
        }

        var parsed = body.intent && body.params
            ? { intent: body.intent, params: body.params, source: "explicit" }
            : agentParser.parse(body.command || "");

        if (!parsed || !parsed.intent) {
            res.json({ success: false, error: "Could not parse command.", parsed: parsed });
            return next();
        }

        var policyResult = agentPolicy.validate(parsed.intent, parsed.params);
        if (!policyResult.ok) {
            res.json({ success: false, error: policyResult.error, details: policyResult.details || null });
            return next();
        }

        var execResult = agentExecutor.execute(parsed.intent, parsed.params, {
            dryRun: dryRun,
            confirm: confirm
        });

        agentAudit.log({
            intent: parsed.intent,
            params: parsed.params,
            dryRun: dryRun,
            success: execResult.success,
            result: execResult.result,
            error: execResult.error
        });

        res.json({
            success: execResult.success,
            intent: parsed.intent,
            params: parsed.params,
            dryRun: dryRun,
            result: execResult.result || null,
            error: execResult.error || null
        });
    } catch (e) {
        res.json({ success: false, error: "Agent error: " + e.message });
    }

    next();
});

module.exports = server.exports();
