"use strict";

var Site = require("dw/system/Site");
var OCAPIService = require("*/cartridge/scripts/helpers/OCAPIServiceHelper");

const FALLBACK_OCAPI_VERSION = "v25_6";
const SERVICE_NAME = "ocapi.data";

function buildUrl(path) {
    var service = OCAPIService.createOCAPIService(SERVICE_NAME);
    var credentials = service.getConfiguration().getCredential();
    var ocapiVersion = credentials.custom.ocapiVersion || FALLBACK_OCAPI_VERSION;
    var hostName = Site.getCurrent().getHttpsHostName() + "/s/-";
    var baseUrl = service.getURL()
        .replace("{hostName}", hostName)
        .replace("{version}", ocapiVersion);
    return baseUrl + path.replace(/^\//, "");
}

function call(method, path, body) {
    var service = OCAPIService.createOCAPIService(SERVICE_NAME);
    var url = buildUrl(path);

    var params = {
        method: method,
        URL: url,
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + OCAPIService.getToken().access_token
        },
        body: body || null
    };

    return service.call(params);
}

module.exports = {
    call: call
};
