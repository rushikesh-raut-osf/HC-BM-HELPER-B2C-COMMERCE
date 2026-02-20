"use strict";

var allowedIntents = {
    CreatePromotion: true,
    ActivatePriceBook: true,
    BulkUpdateProductAttributes: true
};

function validate(intent, params) {
    if (!allowedIntents[intent]) {
        return { ok: false, error: "Intent not allowed." };
    }

    params = params || {};

    switch (intent) {
        case "CreatePromotion":
            if (!params.campaignId) {
                return { ok: false, error: "campaignId is required for CreatePromotion." };
            }
            if (!params.discountPercent) {
                return { ok: false, error: "discountPercent is required for CreatePromotion." };
            }
            if (!params.categoryId && !params.productIds) {
                return { ok: false, error: "categoryId or productIds is required for CreatePromotion." };
            }
            return { ok: true };

        case "ActivatePriceBook":
            if (!params.priceBookId) {
                return { ok: false, error: "priceBookId is required for ActivatePriceBook." };
            }
            return { ok: true };

        case "BulkUpdateProductAttributes":
            if (!params.products || !params.products.length) {
                return { ok: false, error: "products array is required for BulkUpdateProductAttributes." };
            }
            return { ok: true };
        default:
            return { ok: false, error: "Unsupported intent." };
    }
}

module.exports = {
    validate: validate
};
