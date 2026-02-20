"use strict";

var agentOCAPI = require("*/cartridge/scripts/helpers/agentOCAPI");

function execute(intent, params, options) {
    params = params || {};
    options = options || {};
    var dryRun = options.dryRun !== false;

    switch (intent) {
        case "CreatePromotion":
            return executeCreatePromotion(params, dryRun);
        case "ActivatePriceBook":
            return executeActivatePriceBook(params, dryRun);
        case "BulkUpdateProductAttributes":
            return executeBulkUpdate(params, dryRun);
        default:
            return { success: false, error: "Unsupported intent." };
    }
}

function executeCreatePromotion(params, dryRun) {
    var payload = buildPromotionPayload(params);
    var actions = [
        { method: "PUT", path: "/promotions/" + params.promotionId, body: payload },
        { method: "PUT", path: "/promotion_campaigns/" + params.campaignId + "/promotions/" + params.promotionId, body: {} }
    ];

    if (dryRun) {
        return { success: true, result: { dryRun: true, actions: actions } };
    }

    var create = agentOCAPI.call(actions[0].method, actions[0].path, actions[0].body);
    if (!create.ok) {
        return { success: false, error: "Failed to create promotion." };
    }
    var assign = agentOCAPI.call(actions[1].method, actions[1].path, actions[1].body);
    if (!assign.ok) {
        return { success: false, error: "Failed to assign promotion to campaign." };
    }

    return { success: true, result: { created: true, assigned: true } };
}

function buildPromotionPayload(params) {
    var id = params.promotionId || ("promo_" + new Date().getTime());
    var startDate = params.startDate || null;
    var endDate = params.endDate || null;
    var discountPercent = params.discountPercent || 0;

    var condition = {
        type: "category",
        category_id: params.categoryId
    };

    var action = {
        type: "percentage",
        amount: discountPercent
    };

    return {
        id: id,
        name: params.name || id,
        enabled: true,
        start_date: startDate,
        end_date: endDate,
        promotion_class: "product",
        promotion_type: "product",
        condition: condition,
        action: action
    };
}

function executeActivatePriceBook(params, dryRun) {
    var path = "/price_books/" + params.priceBookId;
    var payload = {
        online: true
    };
    if (params.validFrom) {
        payload.valid_from = params.validFrom;
    }
    if (params.validTo) {
        payload.valid_to = params.validTo;
    }

    if (dryRun) {
        return { success: true, result: { dryRun: true, actions: [{ method: "PATCH", path: path, body: payload }] } };
    }

    var result = agentOCAPI.call("PATCH", path, payload);
    if (!result.ok) {
        return { success: false, error: "Failed to update price book." };
    }

    return { success: true, result: { updated: true } };
}

function executeBulkUpdate(params, dryRun) {
    var actions = [];
    params.products.forEach(function (p) {
        var body = buildProductPatch(p);
        actions.push({ method: "PATCH", path: "/products/" + p.id, body: body });
    });

    if (dryRun) {
        return { success: true, result: { dryRun: true, actions: actions } };
    }

    for (var i = 0; i < actions.length; i++) {
        var res = agentOCAPI.call(actions[i].method, actions[i].path, actions[i].body);
        if (!res.ok) {
            return { success: false, error: "Failed to update product: " + params.products[i].id };
        }
    }

    return { success: true, result: { updated: actions.length } };
}

function buildProductPatch(product) {
    var body = {};
    if (product.custom) {
        Object.keys(product.custom).forEach(function (key) {
            body["c_" + key] = product.custom[key];
        });
    }
    if (product.standard) {
        Object.keys(product.standard).forEach(function (key) {
            body[key] = product.standard[key];
        });
    }
    return body;
}

module.exports = {
    execute: execute
};
