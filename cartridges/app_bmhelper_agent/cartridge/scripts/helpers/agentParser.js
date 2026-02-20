"use strict";

var Site = require("dw/system/Site");
var LocalServiceRegistry = require("dw/svc/LocalServiceRegistry");
var Logger = require("dw/system/Logger");

var logger = Logger.getLogger("Agent");

function callLlmParser(command) {
    var serviceId = Site.getCurrent().getCustomPreferenceValue("AgentLLMServiceId") || "agent.llm";
    var service = LocalServiceRegistry.createService(serviceId, {
        createRequest: function (svc, params) {
            svc.setRequestMethod("POST");
            svc.addHeader("Content-Type", "application/json");
            if (params.headers) {
                Object.keys(params.headers).forEach(function (key) {
                    svc.addHeader(key, params.headers[key]);
                });
            }
            return JSON.stringify(params.body);
        },
        parseResponse: function (svc, response) {
            return response;
        },
        filterLogMessage: function (msg) {
            return msg;
        }
    });

    var payload = {
        prompt: "Parse the command into JSON with keys intent and params. " +
            "Supported intents: CreatePromotion, ActivatePriceBook, BulkUpdateProductAttributes.",
        command: command
    };

    var result = service.call({ body: payload });
    if (!result.ok) {
        logger.error("LLM parser failed: {0}", result.errorMessage || "unknown error");
        return null;
    }

    try {
        return JSON.parse(result.object.text);
    } catch (e) {
        logger.error("LLM parser JSON error: {0}", e.message);
        return null;
    }
}

function parseRuleBased(command) {
    if (!command) return null;
    var text = command.toLowerCase();

    if (text.indexOf("price book") > -1 && (text.indexOf("activate") > -1 || text.indexOf("enable") > -1)) {
        return {
            intent: "ActivatePriceBook",
            params: {
                priceBookId: extractId(command),
                validFrom: extractDate(command, "from"),
                validTo: extractDate(command, "to")
            },
            source: "rule"
        };
    }

    if (text.indexOf("promotion") > -1 || text.indexOf("off") > -1) {
        return {
            intent: "CreatePromotion",
            params: {
                promotionId: extractId(command),
                campaignId: extractCampaignId(command),
                discountPercent: extractPercent(command),
                categoryId: extractCategory(command),
                startDate: extractDate(command, "start"),
                endDate: extractDate(command, "end")
            },
            source: "rule"
        };
    }

    if (text.indexOf("update products") > -1 || text.indexOf("bulk update") > -1) {
        return {
            intent: "BulkUpdateProductAttributes",
            params: {
                products: []
            },
            source: "rule"
        };
    }

    return null;
}

function extractPercent(command) {
    var match = /(\d{1,2})\s*%/.exec(command);
    return match ? parseInt(match[1], 10) : null;
}

function extractId(command) {
    var match = /\b(id|code)\s*[:=]\s*([a-zA-Z0-9_\-]+)/.exec(command);
    return match ? match[2] : null;
}

function extractCampaignId(command) {
    var match = /\bcampaign\s*[:=]\s*([a-zA-Z0-9_\-]+)/i.exec(command);
    return match ? match[1] : null;
}

function extractCategory(command) {
    var match = /\bcategory\s*[:=]\s*([a-zA-Z0-9_\-]+)/i.exec(command);
    return match ? match[1] : null;
}

function extractDate(command, keyword) {
    var regex = new RegExp(keyword + "\\s*[:=]\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", "i");
    var match = regex.exec(command);
    return match ? match[1] : null;
}

function parse(command) {
    var llmEnabled = Site.getCurrent().getCustomPreferenceValue("AgentLLMEnabled");
    if (llmEnabled) {
        var llmResult = callLlmParser(command);
        if (llmResult && llmResult.intent) {
            llmResult.source = "llm";
            return llmResult;
        }
    }
    return parseRuleBased(command);
}

module.exports = {
    parse: parse
};
