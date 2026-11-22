/**
 * PLOC SDK v1.0.0
 * Copyright (c) 2026 PLOC. Released under the MIT License.
 */

const REQUEST_TIMEOUT = 30000;
const NO_TIMEOUT = 0;
const FILE_TIMEOUT = 5 * 60 * 1000;
const TRANSFER_TIMEOUT = 30 * 60 * 1000;

const REQUEST_TIMEOUTS = Object.freeze({
    dialogAlert: NO_TIMEOUT,
    dialogConfirm: NO_TIMEOUT,
    dialogPrompt: NO_TIMEOUT,
    dialogPick: NO_TIMEOUT,
    uiShare: NO_TIMEOUT,
    backupCreateFile: FILE_TIMEOUT,
    csvCreateFiles: FILE_TIMEOUT,
    pdfCreateFile: FILE_TIMEOUT,
    filesRead: FILE_TIMEOUT,
    filesWrite: FILE_TIMEOUT,
    networkUpload: TRANSFER_TIMEOUT,
    networkDownload: TRANSFER_TIMEOUT,
    miniAppInstall: TRANSFER_TIMEOUT,
    privateScriptRun: NO_TIMEOUT,
    backupRestoreFile: TRANSFER_TIMEOUT,
});

const SDK_ERROR_CODES = {
    NO_SDK: "NO_SDK",
    NOT_FOUND: "NOT_FOUND",
    TIMEOUT: "TIMEOUT",
    NO_BRIDGE: "NO_BRIDGE",
    INVALID_PARAMS: "INVALID_PARAMS",
    INTERNAL_ERROR: "INTERNAL_ERROR",
};

let _gateway = null;

const _nativeGateway = (() => {
    let _auth = null;
    let _pendingRequests = {};
    let _requestCounter = 0;

    function init(auth) {
        _auth = auth;

        globalThis._nativeCallback = (responseJSON) => {
            const response = typeof responseJSON === "string"
                ? JSON.parse(responseJSON)
                : responseJSON;
            const pending = _pendingRequests[response.id];

            if (!pending) {
                return;
            }

            delete _pendingRequests[response.id];

            if (response.success) {
                pending.resolve(response.data);
            } else {
                if (response.error.code === SDK_ERROR_CODES.NOT_FOUND) {
                    pending.resolve(null);
                } else {
                    const err = new SDKError(response.error.code, response.error.message);
                    _logger.error(`${err.code}: ${err.message}`);
                    pending.reject(err);
                }
            }
        };

        _logger.info("Gateway initialized (native)");
    }

    function send(method, params = {}, timeoutOverride = undefined) {
        if (!_auth) {
            throw new SDKError(SDK_ERROR_CODES.NO_SDK, "SDK not initialized");
        }

        const start = Date.now();

        _logger.info(`→ ${method}`, params);

        const timeout = timeoutOverride ?? REQUEST_TIMEOUTS[method] ?? REQUEST_TIMEOUT;

        return new Promise((resolve, reject) => {
            const id = `req_${Date.now()}_${++_requestCounter}`;
            let timer = null;

            _pendingRequests[id] = {
                resolve: (data) => {
                    clearTimeout(timer);
                    _logger.info(`← ${method} (${Date.now() - start}ms)`);
                    resolve(data);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            };

            const message = {
                id,
                method,
                token: _auth.token,
                params,
            };

            if (typeof _nativeGatewaySend === "function") {
                _nativeGatewaySend(message);
            } else if (window.webkit?.messageHandlers?.nativeGateway) {
                window.webkit.messageHandlers.nativeGateway.postMessage(message);
            } else if (window.nativeGateway) {
                window.nativeGateway.postMessage(JSON.stringify(message));
            } else {
                delete _pendingRequests[id];
                reject(new SDKError(SDK_ERROR_CODES.NO_BRIDGE, "No native bridge available"));
                return;
            }

            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (_pendingRequests[id]) {
                        delete _pendingRequests[id];
                        const err = new SDKError(SDK_ERROR_CODES.TIMEOUT, `Request ${method} timed out`);
                        _logger.error(err.message);
                        reject(err);
                    }
                }, timeout);
            }
        });
    }

    function isAvailable() {
        return (typeof _nativeGatewayAvailable === "function" && _nativeGatewayAvailable())
            || !!(window.webkit?.messageHandlers?.nativeGateway)
            || !!(window.nativeGateway);
    }

    return { init, send, isAvailable };
})();

const _mockGateway = (() => {
    const handlers = {};

    return {
        init(auth) {
            _logger.info("Gateway initialized (mock)");
        },

        send(method, params = {}) {
            const start = Date.now();
            _logger.info(`→ ${method}`, params);

            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    const handler = handlers[method];
                    if (!handler) {
                        const err = new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, `Unknown method: ${method}`);
                        _logger.error(err.message);
                        reject(err);
                        return;
                    }

                    try {
                        const result = handler(params);
                        _logger.info(`← ${method} (${Date.now() - start}ms)`);
                        resolve(result);
                    } catch (err) {
                        const sdkErr = new SDKError(err.code || SDK_ERROR_CODES.INTERNAL_ERROR, err.message || "Mock error");
                        _logger.error(`${sdkErr.code}: ${sdkErr.message}`);
                        reject(sdkErr);
                    }

                }, 50);
            });
        },
    };
})();

class Authorization {
    constructor(token = null) {
        this.token = token || Authorization.resolveToken();
    }

    static resolveToken() {
        if (globalThis != null && globalThis.__PLOC_AUTH_TOKEN__) {
            return globalThis.__PLOC_AUTH_TOKEN__;
        }

        return Math.random().toString(36).substring(2, 12);
    }
}

class Logger {
    constructor() {
        this.enabled = true;
    }

    info(...args) {
        if (this.enabled) {
            console.log("[SDK]", ...args);
        }
    }

    error(...args) {
        if (this.enabled) {
            console.error("[SDK]", ...args);
        }
    }
}

const _logger = new Logger();

/**
 * Error thrown (rejected) by SDK calls: always await them inside try / catch.
 * `code` is one of SDK_ERROR_CODES: INVALID_PARAMS (missing or malformed argument,
 * checked before anything is sent), TIMEOUT, NOT_FOUND, NO_BRIDGE / NO_SDK (outside the
 * PLOC app) or INTERNAL_ERROR.
 *
 * Not every failure throws: some methods resolve `null` when the app returns nothing.
 * Check for `null` as well as catching.
 */
class SDKError extends Error {
    constructor(code, message) {
        super(message);

        this.code = code;
        this.name = "SDKError";

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SDKError);
        }
    }

    toString() {
        return `[${this.code}] ${this.message}`;
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message
        };
    }
}

function _secondsToDate(value) {
    return value ? new Date(value * 1000) : null;
}

function _normalizeParams(params, key) {
    if (typeof params === "string") {
        return { [key]: params };
    }

    return params ?? {};
}

class UIService {
    async openPloud() {
        return _gateway.send("uiOpenPloud", {});
    }

    async openBackupCenter() {
        return _gateway.send("uiOpenBackupCenter", {});
    }

    async openAbout() {
        return _gateway.send("uiOpenAbout", {});
    }

    async openUrl(params) {
        return _gateway.send("uiOpenUrl", _normalizeParams(params, "url"));
    }

    async openWines(params) {
        return _gateway.send("uiOpenWines", _normalizeParams(params, "query"));
    }

    async openWineFilters(params) {
        return _gateway.send("uiOpenWineFilters", params);
    }

    async openRacks(params) {
        return _gateway.send("uiOpenRacks", _normalizeParams(params, "query"));
    }

    async openTastingNotes(params) {
        return _gateway.send("uiOpenTastingNotes", _normalizeParams(params, "query"));
    }

    async openPreferences() {
        return _gateway.send("uiOpenPreferences", {});
    }

    async openImplocation() {
        return _gateway.send("uiOpenImplocation", {});
    }

    async openStatistics() {
        return _gateway.send("uiOpenStatistics", {});
    }

    async openAccount() {
        return _gateway.send("uiOpenAccount", {});
    }

    async openObservintoire(params) {
        return _gateway.send("uiOpenObservintoire", params);
    }

    async openSupportUs() {
        return _gateway.send("uiOpenSupportUs", {});
    }

    async openMyWineRequests() {
        return _gateway.send("uiOpenMyWineRequests", {});
    }

    async openDansTonPloc() {
        return _gateway.send("uiOpenDansTonPloc", {});
    }

    async openCsvExport(params) {
        return _gateway.send("uiOpenCsvExport", params);
    }

    async openReportCenter(params) {
        return _gateway.send("uiOpenReportCenter", params);
    }

    async openWine(params) {
        return _gateway.send("uiOpenWine", _normalizeParams(params, "id"));
    }

    async openRack(params) {
        return _gateway.send("uiOpenRack", _normalizeParams(params, "id"));
    }

    async openRackOnboarding() {
        return _gateway.send("uiOpenRackOnboarding", {});
    }

    async openTastingNotesOnboarding() {
        return _gateway.send("uiOpenTastingNotesOnboarding", {});
    }

    async openRackWizard() {
        return _gateway.send("uiOpenRackWizard", {});
    }

    async openRackEditor(params) {
        return _gateway.send("uiOpenRackEditor", _normalizeParams(params, "id"));
    }

    async openTastingNote(params) {
        return _gateway.send("uiOpenTastingNote", _normalizeParams(params, "id"));
    }

    async openOrder(params) {
        return _gateway.send("uiOpenOrder", _normalizeParams(params, "id"));
    }

    async openVendor(params) {
        return _gateway.send("uiOpenVendor", _normalizeParams(params, "id"));
    }

    async openOwner(params) {
        return _gateway.send("uiOpenOwner", _normalizeParams(params, "id"));
    }

    async openCurrencyPreferences() {
        return _gateway.send("uiOpenCurrencyPreferences", {});
    }

    async openFiveStarsDialog() {
        return _gateway.send("uiOpenFiveStarsDialog", {});
    }

    async openScriptEditorHost(params) {
        return _gateway.send("uiOpenScriptEditorHost", _normalizeParams(params, "script"));
    }

    async openDrops() {
        return _gateway.send("uiOpenDrops", {});
    }

    async openCommunity(params) {
        return _gateway.send("uiOpenCommunity", params);
    }

    async openMiniApps() {
        return _gateway.send("uiOpenMiniApps", {});
    }

    async share(params) {
        if (typeof params === "string" || Array.isArray(params)) {
            return this.shareFiles(params);
        }

        return _gateway.send("uiShare", params);
    }

    /**
     * Share local files by path.
     * @throws {SDKError} INVALID_PARAMS if no path is given.
     */
    async shareFiles(params) {
        const paths = (Array.isArray(params) ? params : [params])
            .filter(path => typeof path === "string" && path !== "");

        if (paths.length === 0) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "shareFiles requires a path or an array of paths");
        }

        return _gateway.send("uiShare", { paths });
    }

    /**
     * @throws {SDKError} INVALID_PARAMS if `base64` is missing or empty.
     */
    async shareImage(params) {
        if (!params || typeof params.base64 !== "string" || params.base64 === "") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "shareImage requires base64");
        }

        return _gateway.send("uiShare", { base64: params.base64 });
    }

    /**
     * @throws {SDKError} INVALID_PARAMS if the text is missing or empty.
     */
    async shareText(params) {
        const text = typeof params === "string" ? params : params?.text;

        if (typeof text !== "string" || text === "") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "shareText requires a text");
        }

        return _gateway.send("uiShare", { text });
    }

    async openPop(params) {
        return _gateway.send("uiOpenPop", params);
    }

    async openIconPreferences(params) { // iOS only
        return _gateway.send("uiOpenIconPreferences", params);
    }

    async closeWindow() {
        return _gateway.send("uiCloseWindow", {});
    }
}

class BridgeService {
    async send(method, params = {}) {
        return _gateway.send(method, params);
    }
}

class Repository {
    constructor(modelClass) {
        this.model = modelClass;
    }

    get(id) {
        return this.model.get(id);
    }

    getAll() {
        return this.model.getAll();
    }

    find(param) {
        return this.model.find(param);
    }

    findFirst(param) {
        return this.model.findFirst(param);
    }
}

class CellarService {
    constructor() {
        this.country = new Repository(Country);
        this.region = new Repository(Region);
        this.appellation = new Repository(Appellation);
        this.grape = new Repository(Grape);
        this.classification = new Repository(Classification);
        this.color = new Repository(Color);
        this.bottleFormat = new Repository(BottleFormat);
        this.vendor = new Repository(Vendor);
        this.owner = new Repository(Owner);
        this.parameter = new Repository(Parameter);
        this.wine = new Repository(Wine);
        this.order = new Repository(Order);
        this.rack = new Repository(Rack);
        this.document = new Repository(Document);
        this.tastingNotes = new Repository(TastingNotes);
    }

    async getInfo() {
        const info = (await _gateway.send("cellarGetInfo", {})) ?? {};
        const counts = info.counts ?? {};

        return {
            identifier: info.identifier ?? null,
            empty: info.empty === true,
            locked: info.locked === true,
            currency: info.currency ?? null,
            size: info.size ?? 0,
            counts: {
                wines: counts.wines ?? 0,
                bottles: counts.bottles ?? 0,
                tastingNotes: counts.tastingNotes ?? 0,
                racks: counts.racks ?? 0,
                orders: counts.orders ?? 0,
                documents: counts.documents ?? 0,
                vendors: counts.vendors ?? 0,
                owners: counts.owners ?? 0,
            },
        };
    }
}

function _assertTimeout(method, timeout) {
    if (timeout !== undefined && (typeof timeout !== "number" || !(timeout >= 0))) {
        throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, `${method} timeout must be a number of milliseconds >= 0`);
    }
}

class NetworkService {
    /**
     * Resolve `null` on failure.
     * @throws {SDKError} INVALID_PARAMS without `url` or with an invalid `timeout`; TIMEOUT when it expires.
     */
    async fetchBase64(params) {
        params = _normalizeParams(params, "url");

        if (typeof params.url !== "string" || params.url === "") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "fetchBase64 requires url");
        }

        _assertTimeout("fetchBase64", params.timeout);

        return _gateway.send("networkBase64", { url: params.url }, params.timeout);
    }

    /**
     * Stream a URL to a local file. Resolve `null` on failure.
     * @throws {SDKError} INVALID_PARAMS without `url`.
     */
    async download(params) {
        params = _normalizeParams(params, "url");

        if (!params.url) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "download requires url");
        }

        const file = await _gateway.send("networkDownload", params);

        return file ? { path: file.path, size: file.size } : null;
    }

    /**
     * Default method is GET, `body` must be a string. Resolve `null` on failure.
     * @throws {SDKError} INVALID_PARAMS without `url`, with a non-string `method` or `body`, or an invalid `timeout`; TIMEOUT when it expires.
     */
    async request(params) {
        params = _normalizeParams(params, "url");

        if (typeof params.url !== "string" || params.url === "") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "request requires url");
        }

        const method = params.method === undefined ? "GET" : params.method;

        if (typeof method !== "string" || method === "") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "request method must be a string");
        }

        if (params.body !== undefined && params.body !== null && typeof params.body !== "string") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "request body must be a string");
        }

        _assertTimeout("request", params.timeout);

        const { timeout, ...message } = params;
        const res = await _gateway.send("networkRequest", { ...message, method: method.toUpperCase() }, timeout);

        return res
            ? { status: res.status ?? null, headers: res.headers ?? {}, body: res.body ?? null }
            : null;
    }

    /**
     * Stream a local file to a URL (default method PUT). Resolve `null` on failure.
     * @throws {SDKError} INVALID_PARAMS without `path` or `url`.
     */
    async upload(params) {
        if (!params || !params.path || !params.url) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "upload requires path and url");
        }

        return _gateway.send("networkUpload", params);
    }
}

class DialogService {
    async alert(params) {
        await _gateway.send("dialogAlert", _normalizeParams(params, "message"));
    }

    async confirm(params) {
        const result = await _gateway.send("dialogConfirm", _normalizeParams(params, "message"));
        return result === true;
    }

    async prompt(params) {
        const result = await _gateway.send("dialogPrompt", _normalizeParams(params, "message"));
        return result ?? null;
    }

    /**
     * @throws {SDKError} INVALID_PARAMS if the text is missing or empty.
     */
    async toast(params) {
        params = _normalizeParams(params, "text");

        if (typeof params.text !== "string" || params.text === "") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "toast requires text");
        }

        await _gateway.send("dialogToast", { text: params.text });
    }

    async pick(params) {
        const result = await this._pick(params, false);
        return result ? (result[0] ?? null) : null;
    }

    async pickMany(params) {
        return this._pick(params, true);
    }

    async _pick(params, multiple) {
        const method = multiple ? "pickMany" : "pick";

        if (Array.isArray(params)) {
            params = { items: params };
        }

        if (!params || !Array.isArray(params.items) || params.items.length === 0) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, `${method} requires a non-empty array of items`);
        }

        const items = params.items.map(item => (typeof item === "string"
            ? { id: item, text: null }
            : { id: item?.id, text: item?.text ?? null }));

        if (items.some(item => typeof item.id !== "string" || item.id === ""
            || (item.text !== null && typeof item.text !== "string"))) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, `${method} items must be ids or { id, text } objects`);
        }

        if (new Set(items.map(item => item.id)).size !== items.length) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, `${method} items must have unique ids`);
        }

        const selected = params.selected ?? [];

        if (!Array.isArray(selected) || selected.some(id => typeof id !== "string")) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, `${method} selected must be an array of ids`);
        }

        const result = await _gateway.send("dialogPick", {
            title: params.title,
            items,
            selected: multiple ? selected : selected.slice(0, 1),
            multiple,
        });

        if (!Array.isArray(result)) {
            return null;
        }

        return result
            .map(entry => (typeof entry === "string" ? { id: entry, text: null } : entry))
            .filter(entry => typeof entry?.id === "string")
            .map(entry => ({
                id: entry.id,
                text: entry.text ?? items.find(item => item.id === entry.id)?.text ?? null,
            }));
    }
}

class BackupService {
    static STATUS = Object.freeze({
        IDLE: 0,
        FETCHING: 1,
        UPLOADING: 2,
        DOWNLOADING: 3,
        ERROR: 255,
    });

    get STATUS() {
        return BackupService.STATUS;
    }

    async enable() {
        return (await _gateway.send("backupEnable", {})) === true;
    }

    async disable() {
        await _gateway.send("backupDisable", {});
    }

    async getInfo() {
        const info = (await _gateway.send("backupGetInfo", {})) ?? {};

        return {
            enabled: info.enabled === true,
            canEnable: info.canEnable === true,
            status: info.status ?? BackupService.STATUS.IDLE,
            lastBackupDate: _secondsToDate(info.lastBackupDate),
            lastManualBackupDate: _secondsToDate(info.lastManualBackupDate),
        };
    }

    async backupNow() {
        return _gateway.send("backupStart", {});
    }

    async createBackupFile() {
        const file = await _gateway.send("backupCreateFile", {});

        return file ? { path: file.path, size: file.size } : null;
    }

    async restoreBackupFile(params) {
        params = _normalizeParams(params, "path");

        if (!params.path) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "restoreBackupFile requires path");
        }

        return (await _gateway.send("backupRestoreFile", params)) === true;
    }

    async open() {
        return _gateway.send("uiOpenBackupCenter", {});
    }
}

class PloudService {
    static STATUS = Object.freeze({
        INACTIVE: 0,
        IDLE: 1,
        WORKING: 2,
        ERROR: 256,
    });

    get STATUS() {
        return PloudService.STATUS;
    }

    async getInfo() {
        const info = (await _gateway.send("ploudGetInfo", {})) ?? {};

        return {
            enabled: info.enabled === true,
            canEnable: info.canEnable === true,
            status: info.status ?? PloudService.STATUS.INACTIVE,
            server: info.server ?? null,
            deviceIdentifier: info.deviceIdentifier ?? null,
            lastSyncDate: _secondsToDate(info.lastSyncDate),
            cellarLocked: info.cellarLocked === true,
        };
    }

    async syncNow() {
        return (await _gateway.send("ploudSyncStart", {})) === true;
    }

    async open() {
        return _gateway.send("uiOpenPloud", {});
    }
}

class CsvService {
    async createFiles(params) {
        params = params ?? {};

        const files = await _gateway.send("csvCreateFiles", { documents: params.documents === true });

        return Array.isArray(files)
            ? files.map(file => ({ path: file.path, size: file.size }))
            : null;
    }

    async open() {
        return _gateway.send("uiOpenCsvExport", {});
    }
}

function _base64ToUtf8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder().decode(bytes);
}

function _utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";

    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }

    return btoa(binary);
}

class PdfService {
    async createFile(params) {
        const items = Array.isArray(params) ? params : params?.ids;
        const message = {};

        if (items !== undefined && items !== null) {
            const ids = Array.isArray(items)
                ? items.map(item => (typeof item === "string" ? item : item?.id))
                : null;

            if (!ids || ids.length === 0 || ids.some(id => typeof id !== "string" || id === "")) {
                throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "createFile requires a non-empty array of ids");
            }

            message.ids = ids;
        }

        const file = await _gateway.send("pdfCreateFile", message);

        return file ? { path: file.path, size: file.size } : null;
    }

    async open() {
        return _gateway.send("uiOpenReportCenter", {});
    }
}

class MiniAppService {
    async install(params) {
        return _gateway.send("miniAppInstall", _normalizeParams(params, "url"));
    }

    async open() {
        return _gateway.send("uiOpenMiniApps", {});
    }
}

class TranslationsService {
    async get(params, defaultValue = null) {
        const single = typeof params === "string";
        const keys = single ? [params] : params;

        if (!Array.isArray(keys) || keys.length === 0
            || keys.some(key => typeof key !== "string" || key === "")) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "get requires a key or a non-empty array of keys");
        }

        const translations = (await _gateway.send("translationsGet", { keys })) ?? {};
        const dictionary = {};

        for (const key of keys) {
            dictionary[key] = typeof translations[key] === "string" ? translations[key] : defaultValue;
        }

        return single ? dictionary[params] : dictionary;
    }
}

class FilesService {
    /**
     * Resolve `null` on failure.
     * @throws {SDKError} INVALID_PARAMS without `path` or `base64`.
     */
    async writeBase64(params, base64) {
        if (typeof params === "string") {
            params = { path: params, base64 };
        }

        if (!params || typeof params.path !== "string" || params.path === ""
            || typeof params.base64 !== "string") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "writeBase64 requires path and base64");
        }

        const file = await _gateway.send("filesWrite", { path: params.path, base64: params.base64 });

        return file ? { path: file.path, size: file.size } : null;
    }

    /**
     * Resolve `null` on failure.
     * @throws {SDKError} INVALID_PARAMS without `path` or `text`.
     */
    async writeText(params, text) {
        if (typeof params === "string") {
            params = { path: params, text };
        }

        if (!params || typeof params.path !== "string" || params.path === ""
            || typeof params.text !== "string") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "writeText requires path and text");
        }

        return this.writeBase64({ path: params.path, base64: _utf8ToBase64(params.text) });
    }

    /**
     * Resolve `null` when the file cannot be read.
     * @throws {SDKError} INVALID_PARAMS without `path`.
     */
    async readBase64(params) {
        params = _normalizeParams(params, "path");

        if (!params.path) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "readBase64 requires path");
        }

        return (await _gateway.send("filesRead", { path: params.path })) ?? null;
    }

    /**
     * Resolve `null` when the file cannot be read.
     * @throws {SDKError} INVALID_PARAMS without `path`.
     */
    async readText(params) {
        const base64 = await this.readBase64(params);

        return base64 === null ? null : _base64ToUtf8(base64);
    }

    /**
     * @throws {SDKError} INVALID_PARAMS without `path`.
     */
    async exists(params) {
        params = _normalizeParams(params, "path");

        if (!params.path) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "exists requires path");
        }

        return (await _gateway.send("filesExists", { path: params.path })) === true;
    }

    /**
     * @throws {SDKError} INVALID_PARAMS without `path`.
     */
    async delete(params) {
        params = _normalizeParams(params, "path");

        if (!params.path) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "delete requires path");
        }

        return (await _gateway.send("filesDelete", { path: params.path })) === true;
    }
}

class AccountService {
    async getInfo(params) {
        params = _normalizeParams(params, "key");

        if (params.key !== undefined
            && (typeof params.key !== "string" || params.key.length === 0 || params.key.length > 128)) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "key must be a non-empty string of 128 characters max");
        }

        const info = (await _gateway.send("accountGetInfo", params.key === undefined ? {} : { key: params.key })) ?? {};

        return {
            connected: info.connected === true,
            id: info.id ?? null,
        };
    }

    async open() {
        return _gateway.send("uiOpenAccount", {});
    }
}

class AppService {
    async getInfo() {
        const info = (await _gateway.send("appGetInfo", {})) ?? {};

        return {
            name: info.name ?? null,
            version: info.version ?? null,
            build: info.build ?? null,
            platform: info.platform ?? null,
            language: info.language ?? null,
            osVersion: info.osVersion ?? null,
            locale: info.locale ?? null,
        };
    }

    async getPermissions() {
        const permissions = (await _gateway.send("appGetPermissions", {})) ?? {};

        return {
            read: permissions.read === true,
            write: permissions.write === true,
        };
    }
}

class StorageService {
    async get(key, defaultValue = null) {
        _assertStorageKey("get", key);

        const raw = await _gateway.send("storageGet", { key });

        if (raw == null) {
            return defaultValue;
        }

        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }

    /**
     * @throws {SDKError} INVALID_PARAMS if the key is empty or longer than 128 characters, or the value is not JSON-serializable.
     */
    async set(key, value) {
        _assertStorageKey("set", key);

        const raw = JSON.stringify(value);

        if (raw === undefined || (typeof value === "number" && !Number.isFinite(value))) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "storage.set requires a JSON-serializable value");
        }

        await _gateway.send("storageSet", { key, value: raw });
    }

    async has(key) {
        _assertStorageKey("has", key);

        return (await _gateway.send("storageHas", { key })) === true;
    }

    async remove(key) {
        _assertStorageKey("remove", key);

        return (await _gateway.send("storageRemove", { key })) === true;
    }
}

function _assertStorageKey(method, key) {
    if (typeof key !== "string" || key === "") {
        throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, `storage.${method} requires key`);
    }
}

class ClipboardService {
    /**
     * @throws {SDKError} INVALID_PARAMS without text.
     */
    async copy(params) {
        const { text } = _normalizeParams(params, "text");

        if (typeof text !== "string") {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "clipboard.copy requires text");
        }

        await _gateway.send("clipboardCopy", { text });
    }
}

class HapticsService {
    static TYPE = Object.freeze({
        SUCCESS: "success",
        WARNING: "warning",
        ERROR: "error",
        IMPACT_LIGHT: "impact.light",
        IMPACT_MEDIUM: "impact.medium",
        IMPACT_HEAVY: "impact.heavy",
        SELECTION: "selection",
    });

    static IMPACT = Object.freeze({
        LIGHT: "light",
        MEDIUM: "medium",
        HEAVY: "heavy",
    });

    get TYPE() {
        return HapticsService.TYPE;
    }

    get IMPACT() {
        return HapticsService.IMPACT;
    }

    // Return true if the haptic was played, false if unsupported or disabled on this device.
    async play(params) {
        const { type } = _normalizeParams(params, "type");

        if (!Object.values(HapticsService.TYPE).includes(type)) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS,
                `play requires a type: ${Object.values(HapticsService.TYPE).join(", ")}`);
        }

        return (await _gateway.send("hapticsPlay", { type })) === true;
    }

    async success() {
        return this.play(HapticsService.TYPE.SUCCESS);
    }

    async warning() {
        return this.play(HapticsService.TYPE.WARNING);
    }

    async error() {
        return this.play(HapticsService.TYPE.ERROR);
    }

    async impact(style = HapticsService.IMPACT.MEDIUM) {
        if (!Object.values(HapticsService.IMPACT).includes(style)) {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS,
                `impact requires a style: ${Object.values(HapticsService.IMPACT).join(", ")}`);
        }

        return this.play(`impact.${style}`);
    }

    async selection() {
        return this.play(HapticsService.TYPE.SELECTION);
    }
}

class SDK {
    constructor(auth) {
        if (!auth || !(auth instanceof Authorization)) {
            throw new Error("SDK requires an Authorization instance");
        }

        _gateway = _nativeGateway.isAvailable() ? _nativeGateway : _mockGateway;
        _gateway.init(auth);

        this.ui = new UIService();
        this.cellar = new CellarService();
        this.network = new NetworkService();
        this.dialog = new DialogService();
        this.haptics = new HapticsService();
        this.backup = new BackupService();
        this.ploud = new PloudService();
        this.csv = new CsvService();
        this.pdf = new PdfService();
        this.files = new FilesService();
        this.translations = new TranslationsService();
        this.miniApps = new MiniAppService();
        this.account = new AccountService();
        this.app = new AppService();
        this.storage = new StorageService();
        this.clipboard = new ClipboardService();
        this.bridge = new BridgeService();
    }

    get isMock() {
        return _gateway === _mockGateway;
    }
}

class Model {
    constructor(data = {}) {
        this.id = null;
        this.timestamp = null;
        this.timeCreated = null;
        this.timeLastModified = null;
        this.name = null;

        this._assign(data);
    }

    _assign(data) {
        if (typeof data !== "object" || data === null) {
            return;
        }

        this.id = typeof data.id === "string"
            ? data.id
            : this.id;

        this.name = typeof data.name === "string"
            ? data.name
            : this.name;

        this.timestamp = typeof data.timestamp === "number"
            ? data.timestamp
            : this.timestamp;

        this.timeCreated = typeof data.timeCreated === "number"
            ? data.timeCreated
            : this.timeCreated;

        this.timeLastModified = typeof data.timeLastModified === "number"
            ? data.timeLastModified
            : this.timeLastModified;
    }

    async save() {
        const className = this.constructor.name;
        const payload = typeof this.toJSON === "function" ? this.toJSON() : this;
        const savedObject = await _gateway.send(`save${className}`, payload);
        this._assign(savedObject);

        return this;
    }

    async delete() {
        const className = this.constructor.name;
        await _gateway.send(`delete${className}`, { id: this.id });

        return this;
    }

    static async get(id) {
        const className = this.name;
        const data = await _gateway.send(`get${className}`, { id });

        return this._fromJSON(data);
    }

    static async getAll() {
        const className = this.name;
        const data = await _gateway.send(`getAll${className}`);

        return new Collection(
            Array.isArray(data) ? data.map(item => this._fromJSON(item)) : []
        );
    }

    static async findFirst(param) {
        const results = await this.find(param);

        return results.first ?? null;
    }

    static async find(param) {
        const className = this.name;

        let params;

        if (typeof param === "string") {
            params = { name: param };
        } else if (param && typeof param === "object") {
            params = param;
        } else {
            throw new SDKError(SDK_ERROR_CODES.INVALID_PARAMS, "find() expects string or object");
        }

        const data = await _gateway.send(`find${className}`, params);

        if (Array.isArray(data)) {
            return new Collection(data.map(item => this._fromJSON(item)));
        }

        if (data) {
            return new Collection([this._fromJSON(data)]);
        }

        return new Collection([]);
    }

    static _fromJSON(json) {
        return json ? new this(json) : null;
    }
}

class Period {
    constructor(data = {}) {
        this.from = null;
        this.to = null;

        this.from = typeof data.from === "number"
            ? data.from
            : this.from;

        this.to = typeof data.to === "number"
            ? data.to
            : this.to;
    }
}

class Country extends Model {
    createRegion(name) {
        const region = new Region({
            name
        });

        region.country = this;

        return region;
    }

    async getRegions() {
        return await Region.find({ countryId: this.id });
    }
}

class Region extends Model {
    _assign(data) {
        super._assign(data);

        this.countryId = typeof data.countryId === "string"
            ? data.countryId
            : this.countryId ?? null;

        if (data.country && typeof data.country === "object") {
            this.country = new Country(data.country);
        }
    }

    get country() {
        return this._country ?? null;
    }

    set country(value) {
        if (value instanceof Country) {
            this.countryId = value.id;
            this._country = value;
        } else if (typeof value === "string") {
            this.countryId = value;
            this._country = null;
        } else if (value === null) {
            this.countryId = null;
            this._country = null;
        }
    }

    async getCountry() {
        if (this._country) {
            return this._country;
        }

        if (this.countryId) {
            this._country = await Country.get(this.countryId);
            return this._country;
        }

        return null;
    }

    async getAppellations() {
        return await Appellation.find({ regionId: this.id });
    }

    createAppellation(name) {
        const appellation = new Appellation({
            name
        });

        appellation.region = this;

        return appellation;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            countryId: this.countryId,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Appellation extends Model {
    _assign(data) {
        super._assign(data);

        this.regionId = typeof data.regionId === "string"
            ? data.regionId
            : this.regionId ?? null;

        if (data.region && typeof data.region === "object") {
            this.region = new Region(data.region);
        }
    }

    get region() {
        return this._region ?? null;
    }

    set region(value) {
        if (value instanceof Region) {
            this.regionId = value.id;
            this._region = value;
        } else if (typeof value === "string") {
            this.regionId = value;
            this._region = null;
        } else if (value === null) {
            this.regionId = null;
            this._region = null;
        }
    }

    async getRegion() {
        if (this._region) {
            return this._region;
        }

        if (this.regionId) {
            this._region = await Region.get(this.regionId);
            return this._region;
        }

        return null;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            regionId: this.regionId,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Grape extends Model {
}

class Classification extends Model {
}

class Document extends Model {
    _assign(data) {
        super._assign(data);

        this.type = typeof data.type === "number"
            ? data.type
            : this.type;

        this.size = typeof data.size === "number"
            ? data.size
            : this.size;

        this.width = typeof data.width === "number"
            ? data.width
            : this.width;

        this.height = typeof data.height === "number"
            ? data.height
            : this.height;

        this.base64 = typeof data.base64 === "string"
            ? data.base64
            : this.base64;

        this.parentId = typeof data.parentId === "string"
            ? data.parentId
            : this.parentId ?? null;
    }

    async getBase64() {
        if (this.base64) {
            return this.base64;
        }

        if (this.id) {
            try {
                const document = await Document.get(this.id);
                if (document && typeof document.base64 === "string") {
                    this.base64 = document.base64;
                }
            } catch (err) {
                _logger.error(`Error while loading doc : ${this.id} ${err.code ?? "NO_CODE"} : ${err.message}`);
                this.base64 = null;
            }
        }

        return this.base64;
    }

    set parent(value) {
        if (value instanceof Wine) {
            this.parentId = value.id;
        } else if (value instanceof TastingNotes) {
            this.parentId = value.id;
        } else {
            this.parentId = null;
        }
    }

    async loadFromURL(url) {
        try {
            const data = await _gateway.send("networkBase64", { url });
            if (data && data.base64) {
                this.base64 = data.base64;
                this.filename = url.split("/").pop();
            } else {
                this.base64 = null;
            }
        } catch (err) {
            _logger.error(`Error while converting doc : ${err.code ?? "NO_CODE"} : ${err.message}`);
            this.base64 = null;
        }

        return this.base64;
    }

    async loadFromFile(file) {
        this.base64 = await this._blobToBase64(file);
        this.size = file.size;
        this.filename = file.name;

        return this.base64;
    }

    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    toJSON() {
        return {
            id: this.id,
            type: this.type,
            size: this.size,
            width: this.width,
            height: this.height,
            filename: this.filename,
            parentId: this.parentId ?? null,
            base64: this.base64,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Contact extends Model {
    _assign(data) {
        super._assign(data);

        this.contact = typeof data.contact === "string"
            ? data.contact
            : this.contact;

        this.address1 = typeof data.address1 === "string"
            ? data.address1
            : this.address1;

        this.address2 = typeof data.address2 === "string"
            ? data.address2
            : this.address2;

        this.city = typeof data.city === "string"
            ? data.city
            : this.city;

        this.postalCode = typeof data.postalCode === "string"
            ? data.postalCode
            : this.postalCode;

        this.comments = typeof data.comments === "string"
            ? data.comments
            : this.comments;

        this.phone = typeof data.phone === "string"
            ? data.phone
            : this.phone;

        this.fax = typeof data.fax === "string"
            ? data.fax
            : this.fax;

        this.mobilePhone = typeof data.mobilePhone === "string"
            ? data.mobilePhone
            : this.mobilePhone;

        this.email = typeof data.email === "string"
            ? data.email
            : this.email;

        this.website = typeof data.website === "string"
            ? data.website
            : this.website;

        this.latitude = typeof data.latitude === "number"
            ? data.latitude
            : this.latitude;

        this.longitude = typeof data.longitude === "number"
            ? data.longitude
            : this.longitude;

        this.countryId = typeof data.countryId === "string"
            ? data.countryId
            : this.countryId ?? null;

        if (data.country && typeof data.country === "object") {
            this.country = new Country(data.country);
        }
    }

    get country() {
        return this._country ?? null;
    }

    set country(value) {
        if (value instanceof Country) {
            this.countryId = value.id;
            this._country = value;
        } else if (typeof value === "string") {
            this.countryId = value;
            this._country = null;
        } else if (value === null) {
            this.countryId = null;
            this._country = null;
        }
    }

    async getCountry() {
        if (this._country) {
            return this._country;
        }

        if (this.countryId) {
            this._country = await Country.get(this.countryId);
            return this._country;
        }

        return null;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            contact: this.contact,
            address1: this.address1,
            address2: this.address2,
            city: this.city,
            postalCode: this.postalCode,
            comments: this.comments,
            phone: this.phone,
            fax: this.fax,
            mobilePhone: this.mobilePhone,
            email: this.email,
            website: this.website,
            latitude: this.latitude,
            longitude: this.longitude,
            countryId: this.countryId,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Vendor extends Contact {
}

class Owner extends Contact {
}

class BottleFormat extends Model {
    _assign(data) {
        super._assign(data);

        this.volume = typeof data.volume === "number"
            ? data.volume
            : this.volume;

        this.formattedVolume = typeof data.formattedVolume === "string"
            ? data.formattedVolume
            : this.formattedVolume;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            volume: this.volume,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Color extends Model {
    _assign(data) {
        super._assign(data);

        this.readonly = false;

        this.r = typeof data.r === "number"
            ? data.r
            : this.r;

        this.g = typeof data.g === "number"
            ? data.g
            : this.g;

        this.b = typeof data.b === "number"
            ? data.b
            : this.b;

        this.ocValue = typeof data.ocValue === "number"
            ? data.ocValue
            : this.ocValue;
    }

    get hex() {
        const toHex = (v) => {
            const n = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
            return n.toString(16).padStart(2, "0");
        };
        return `#${toHex(this.r)}${toHex(this.g)}${toHex(this.b)}`;
    }

    get rgba() {
        return `rgba(${this.r ?? 0}, ${this.g ?? 0}, ${this.b ?? 0}, ${this.ocValue ?? 1})`;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            r: this.r,
            g: this.g,
            b: this.b,
            ocValue: this.ocValue,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Parameter extends Model {
    _assign(data) {
        super._assign(data);

        this.type = typeof data.type === "number"
            ? data.type
            : this.type;

        this.value = typeof data.value === "string"
            ? data.value
            : this.value;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            value: this.value,
            type: this.type,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Wine extends Model {
    _assign(data) {
        super._assign(data);

        this.vintage = typeof data.vintage === "number"
            ? data.vintage
            : this.vintage;

        this.note = typeof data.note === "number"
            ? data.note
            : this.note;

        this.bottles = typeof data.bottles === "number"
            ? data.bottles
            : this.bottles;

        this.meals = typeof data.meals === "number"
            ? data.meals
            : this.meals;

        this.isFavorite = typeof data.isFavorite === "boolean"
            ? data.isFavorite
            : this.isFavorite;

        this.isPreSheet = typeof data.isPreSheet === "boolean"
            ? data.isPreSheet
            : this.isPreSheet;

        this.latitude = typeof data.latitude === "number"
            ? data.latitude
            : this.latitude;

        this.longitude = typeof data.longitude === "number"
            ? data.longitude
            : this.longitude;

        this.language = typeof data.language === "string"
            ? data.language
            : this.language;

        this.degree = typeof data.degree === "number"
            ? data.degree
            : this.degree;

        this.estimatePrice = typeof data.estimatePrice === "number"
            ? data.estimatePrice
            : this.estimatePrice;

        this.inventoryMode = typeof data.inventoryMode === "number"
            ? data.inventoryMode
            : this.inventoryMode;

        this.reference = typeof data.reference === "string"
            ? data.reference
            : this.reference;

        this.comments = typeof data.comments === "string"
            ? data.comments
            : this.comments;
        
        this.cuvee = typeof data.cuvee === "string"
            ? data.cuvee
            : this.cuvee;

        this.tags = typeof data.tags === "string"
            ? data.tags
            : this.tags;

        this.grapes = typeof data.grapes === "string"
            ? data.grapes
            : this.grapes;

        this.countryId = typeof data.countryId === "string"
            ? data.countryId
            : this.countryId ?? null;

        if (data.country && typeof data.country === "object") {
            this.country = new Country(data.country);
        }

        this.regionId = typeof data.regionId === "string"
            ? data.regionId
            : this.regionId ?? null;

        if (data.region && typeof data.region === "object") {
            this.region = new Region(data.region);
        }

        this.appellationId = typeof data.appellationId === "string"
            ? data.appellationId
            : this.appellationId ?? null;

        if (data.appellation && typeof data.appellation === "object") {
            this.appellation = new Appellation(data.appellation);
        }

        this.classificationId = typeof data.classificationId === "string"
            ? data.classificationId
            : this.classificationId ?? null;

        if (data.classification && typeof data.classification === "object") {
            this.classification = new Classification(data.classification);
        }

        this.bottleFormatId = typeof data.bottleFormatId === "string"
            ? data.bottleFormatId
            : this.bottleFormatId ?? null;

        if (data.bottleFormat && typeof data.bottleFormat === "object") {
            this.bottleFormat = new BottleFormat(data.bottleFormat);
        }

        this.colorId = typeof data.colorId === "string"
            ? data.colorId
            : this.colorId ?? null;

        if (data.color && typeof data.color === "object") {
            this.color = new Color(data.color);
        }

        this.ownerId = typeof data.ownerId === "string"
            ? data.ownerId
            : this.ownerId ?? null;

        if (data.owner && typeof data.owner === "object") {
            this.owner = new Owner(data.owner);
        }

        if (data.apogee && typeof data.apogee === "object") {
            this.apogee = new Period(data.apogee);
        }

        if (data.drinkPeriod && typeof data.drinkPeriod === "object") {
            this.drinkPeriod = new Period(data.drinkPeriod);
        }

        // Serving temperature range in °C (from = min, to = max). Not a date range, unlike apogee and drinkPeriod.
        if (data.service && typeof data.service === "object") {
            this.service = new Period(data.service);
        }

        this.observintoire = data.observintoire;

        if (data.image && typeof data.image === "object") {
            this.image = new Document(data.image);
        }

        if (data.coverImage && typeof data.coverImage === "object") {
            this.coverImage = new Document(data.coverImage);
        }

        if (data.orders && Array.isArray(data.orders)) {
            this.orders = data.orders.map(order => new Order(order));
        }

        if (data.documents && Array.isArray(data.documents)) {
            this.documents = data.documents.map(document => new Document(document));
        }

        if (data.rackItems && Array.isArray(data.rackItems)) {
            this.rackItems = data.rackItems.map(item => new RackItem(item));
        }

        if (data.tastingNotes && Array.isArray(data.tastingNotes)) {
            this.tastingNotes = data.tastingNotes.map(note => new TastingNotes(note));
        }
    }

    get country() {
        return this._country ?? null;
    }

    set country(value) {
        if (value instanceof Country) {
            this.countryId = value.id;
            this._country = value;
        } else if (typeof value === "string") {
            this.countryId = value;
            this._country = null;
        } else if (value === null) {
            this.countryId = null;
            this._country = null;
        }
    }

    async getCountry() {
        if (this._country) {
            return this._country;
        }

        if (this.countryId) {
            this._country = await Country.get(this.countryId);
            return this._country;
        }

        return null;
    }
    
    get region() {
        return this._region ?? null;
    }

    set region(value) {
        if (value instanceof Region) {
            this.regionId = value.id;
            this._region = value;
        } else if (typeof value === "string") {
            this.regionId = value;
            this._region = null;
        } else if (value === null) {
            this.regionId = null;
            this._region = null;
        }
    }

    async getRegion() {
        if (this._region) {
            return this._region;
        }

        if (this.regionId) {
            this._region = await Region.get(this.regionId);
            return this._region;
        }

        return null;
    }

    get appellation() {
        return this._appellation ?? null;
    }

    set appellation(value) {
        if (value instanceof Appellation) {
            this.appellationId = value.id;
            this._appellation = value;
        } else if (typeof value === "string") {
            this.appellationId = value;
            this._appellation = null;
        } else if (value === null) {
            this.appellationId = null;
            this._appellation = null;
        }
    }

    async getAppellation() {
        if (this._appellation) {
            return this._appellation;
        }

        if (this.appellationId) {
            this._appellation = await Appellation.get(this.appellationId);
            return this._appellation;
        }

        return null;
    }

    get classification() {
        return this._classification ?? null;
    }

    set classification(value) {
        if (value instanceof Classification) {
            this.classificationId = value.id;
            this._classification = value;
        } else if (typeof value === "string") {
            this.classificationId = value;
            this._classification = null;
        } else if (value === null) {
            this.classificationId = null;
            this._classification = null;
        }
    }

    async getClassification() {
        if (this._classification) {
            return this._classification;
        }

        if (this.classificationId) {
            this._classification = await Classification.get(this.classificationId);
            return this._classification;
        }

        return null;
    }

    get color() {
        return this._color ?? null;
    }

    set color(value) {
        if (value instanceof Color) {
            this.colorId = value.id;
            this._color = value;
        } else if (typeof value === "string") {
            this.colorId = value;
            this._color = null;
        } else if (value === null) {
            this.colorId = null;
            this._color = null;
        }
    }

    async getColor() {
        if (this._color) {
            return this._color;
        }

        if (this.colorId) {
            this._color = await Color.get(this.colorId);
            return this._color;
        }

        return null;
    }

    get bottleFormat() {
        return this._bottleFormat ?? null;
    }

    set bottleFormat(value) {
        if (value instanceof BottleFormat) {
            this.bottleFormatId = value.id;
            this._bottleFormat = value;
        } else if (typeof value === "string") {
            this.bottleFormatId = value;
            this._bottleFormat = null;
        } else if (value === null) {
            this.bottleFormatId = null;
            this._bottleFormat = null;
        }
    }

    async getBottleFormat() {
        if (this._bottleFormat) {
            return this._bottleFormat;
        }

        if (this.bottleFormatId) {
            this._bottleFormat = await BottleFormat.get(this.bottleFormatId);
            return this._bottleFormat;
        }

        return null;
    }

    get owner() {
        return this._owner ?? null;
    }

    set owner(value) {
        if (value instanceof Owner) {
            this.ownerId = value.id;
            this._owner = value;
        } else if (typeof value === "string") {
            this.ownerId = value;
            this._owner = null;
        } else if (value === null) {
            this.ownerId = null;
            this._owner = null;
        }
    }

    async getOwner() {
        if (this._owner) {
            return this._owner;
        }

        if (this.ownerId) {
            this._owner = await Owner.get(this.ownerId);
            return this._owner;
        }

        return null;
    }

    get image() {
        return this._image ?? null;
    }

    set image(value) {
        if (value instanceof Document) {
            this._image = value;
        } else if (typeof value === "string") {
            this._image = null;
        } else if (value === null) {
            this._image = null;
        }
    }

    async getImage() {
        if (this._image) {
            return this._image;
        }

        return null;
    }

    get coverImage() {
        return this._coverImage ?? null;
    }

    set coverImage(value) {
        if (value instanceof Document) {
            this._coverImage = value;
        } else if (typeof value === "string") {
            this._coverImage = null;
        } else if (value === null) {
            this._coverImage = null;
        }
    }

    async getCoverImage() {
        if (this._coverImage) {
            return this._coverImage;
        }

        return null;
    }

    toJSON() {
        return {
            id: this.id,
            vintage: this.vintage,
            name: this.name,
            colorId: this.colorId,
            countryId: this.countryId,
            regionId: this.regionId,
            appellationId: this.appellationId,
            classificationId: this.classificationId,
            bottleFormatId: this.bottleFormatId,
            ownerId: this.ownerId,
            image: {
                id: this.image?.id ?? null,
                base64: this.image?.base64 ?? null,
                filename: this.image?.filename ?? null
            },
            coverImage: {
                id: this.coverImage?.id ?? null,
                base64: this.coverImage?.base64 ?? null,
                filename: this.coverImage?.filename ?? null
            },
            note: this.note,
            bottles: this.bottles,
            meals: this.meals,
            estimatePrice: this.estimatePrice,
            reference: this.reference,
            comments: this.comments,
            cuvee: this.cuvee,
            tags: this.tags,
            grapes: this.grapes,
            inventoryMode: this.inventoryMode,
            isFavorite: this.isFavorite,
            latitude: this.latitude,
            longitude: this.longitude,
            language: this.language,
            degree: this.degree,
            apogee: {
                from: this.apogee?.from ?? null,
                to: this.apogee?.to ?? null
            },
            drinkPeriod: {
                from: this.drinkPeriod?.from ?? null,
                to: this.drinkPeriod?.to ?? null
            },
            service: {
                from: this.service?.from ?? null,
                to: this.service?.to ?? null
            },
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Order extends Model {
    static OCCASION = Object.freeze({
        NONE: 0,
        ENJOY: 1,
        PARTY: 2,
        GIFT: 4,
        SALE: 8,
        LOST: 16,
        VINDREDI: 32,
        BECAUSE: 64,
        INVENTORY: 128,
        EPHEMERAL_COVID: 200
    });

    _assign(data) {
        super._assign(data);

        this.comments = typeof data.comments === "string"
            ? data.comments
            : this.comments ?? null;

        this.currency = typeof data.currency === "string"
            ? data.currency
            : this.currency ?? null;

        this.purchases = typeof data.purchases === "number"
            ? data.purchases
            : this.purchases ?? null;

        this.consumptions = typeof data.consumptions === "number"
            ? data.consumptions
            : this.consumptions ?? null;

        this.unitPrice = typeof data.unitPrice === "number"
            ? data.unitPrice
            : this.unitPrice ?? null;
        
        this.occasion = typeof data.occasion === "number"
            ? data.occasion
            : this.occasion ?? Order.OCCASION.NONE;

        this.amount = typeof data.amount === "number"
            ? data.amount
            : this.amount ?? null;

        this.date = typeof data.date === "number"
            ? data.date
            : this.date ?? null;

        if (data.vendor && typeof data.vendor === "object") {
            this.vendor = new Vendor(data.vendor);
        }

        if (data.wine && typeof data.wine === "object") {
            this.wine = new Wine(data.wine);
        }

        if (typeof data.vendorId === "string" && !(data.vendor && typeof data.vendor === "object")) {
            this.vendor = data.vendorId;
        }

        if (typeof data.wineId === "string" && !(data.wine && typeof data.wine === "object")) {
            this.wine = data.wineId;
        }
    }

    get vendor() {
        return this._vendor ?? null;
    }

    set vendor(value) {
        if (value instanceof Vendor) {
            this.vendorId = value.id;
            this._vendor = value;
        } else if (typeof value === "string") {
            this.vendorId = value;
            this._vendor = null;
        } else if (value === null) {
            this.vendorId = null;
            this._vendor = null;
        }
    }

    async getVendor() {
        if (this._vendor) {
            return this._vendor;
        }

        if (this.vendorId) {
            this._vendor = await Vendor.get(this.vendorId);
            return this._vendor;
        }

        return null;
    }

    get wine() {
        return this._wine ?? null;
    }

    set wine(value) {
        if (value instanceof Wine) {
            this.wineId = value.id;
            this._wine = value;
        } else if (typeof value === "string") {
            this.wineId = value;
            this._wine = null;
        } else if (value === null) {
            this.wineId = null;
            this._wine = null;
        }
    }

    async getWine() {
        if (this._wine) {
            return this._wine;
        }

        if (this.wineId) {
            this._wine = await Wine.get(this.wineId);
            return this._wine;
        }

        return null;
    }

    get date() {
        return this._date ?? null;
    }

    set date(value) {
        if (value instanceof Date) {
            this._date = value;
        } else if (typeof value === "number") {
            this._date = new Date(value * 1000);
        } else if (value === null) {
            this._date = null;
        }
    }

    toJSON() {
        return {
            id: this.id,
            comments: this.comments,
            currency: this.currency,
            purchases: this.purchases,
            consumptions: this.consumptions,
            unitPrice: this.unitPrice,
            occasion: this.occasion,
            date: this._date ? Math.floor(this._date.getTime() / 1000) : null,
            vendorId: this.vendorId,
            wineId: this.wineId,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class ReadOnlyModel extends Model {
    async save() {
        throw new Error("save() is not allowed for ReadOnlyModel");
    }

    async delete() {
        throw new Error("delete() is not allowed for ReadOnlyModel");
    }
}

class TastingNotes extends Model {
    static MOOD = Object.freeze({
        NONE: 0,
        NASTY: 1,
        BLAH: 2,
        ANGRY: 3,
        BANAL: 4,
        SURPRISED: 5,
        HAPPY: 6,
        LOVE: 7
    });

    static TEMPLATES = Object.freeze({
        SIMPLE: "PLOC-010",
        EXPERT: "PLOC-001"
    });

    _assign(data) {
        super._assign(data);

        this.template = TastingNotes.TEMPLATES.SIMPLE;

        this.vintage = typeof data.vintage === "number"
            ? data.vintage
            : this.vintage;

        if (data.date !== undefined) {
            this.date = data.date;
        }

        this.note = typeof data.note === "number"
            ? data.note
            : this.note;

        this.mood = typeof data.mood === "number"
            ? data.mood
            : TastingNotes.MOOD.NONE;

        this.latitude = typeof data.latitude === "number"
            ? data.latitude
            : this.latitude;

        this.longitude = typeof data.longitude === "number"
            ? data.longitude
            : this.longitude;
        
        this.template = typeof data.template === "string"
            ? data.template
            : this.template;

        this.language = typeof data.language === "string"
            ? data.language
            : this.language;

        this.comments = typeof data.comments === "string"
            ? data.comments
            : this.comments;
        
        this.place = typeof data.place === "string"
            ? data.place
            : this.place;

        this.meals = typeof data.meals === "string"
            ? data.meals
            : this.meals;

        this.people = typeof data.people === "string"
            ? data.people
            : this.people;

        if (data.color && typeof data.color === "object") {
            this.color = new Color(data.color);
            this.color.readonly = true;
        } else {
            this.color = null;
        }

        this.wineId = typeof data.wineId === "string"
            ? data.wineId
            : this.wineId ?? null;

        if (data.wine && typeof data.wine === "object") {
            this.wine = new Wine(data.wine);
        }

        this.observintoire = data.observintoire;

        if (data.image && typeof data.image === "object") {
            this.image = new Document(data.image);
        }

        if (data.documents && Array.isArray(data.documents)) {
            this.documents = data.documents.map(document => new Document(document));
        }
    }

    get wine() {
        return this._wine ?? null;
    }

    set wine(value) {
        if (value instanceof Wine) {
            this.wineId = value.id;
            this._wine = value;
        } else if (typeof value === "string") {
            this.wineId = value;
            this._wine = null;
        } else if (value === null) {
            this.wineId = null;
            this._wine = null;
        }
    }

    async getWine() {
        if (this._wine) {
            return this._wine;
        }

        if (this.wineId) {
            this._wine = await Wine.get(this.wineId);
            return this._wine;
        }

        return null;
    }

    get image() {
        return this._image ?? null;
    }

    set image(value) {
        if (value instanceof Document) {
            this._image = value;
        } else if (typeof value === "string") {
            this._image = null;
        } else if (value === null) {
            this._image = null;
        }
    }

    async getImage() {
        if (this._image) {
            return this._image;
        }

        return null;
    }

    get date() {
        return this._date ?? null;
    }

    set date(value) {
        if (value instanceof Date) {
            this._date = value;
        } else if (typeof value === "number") {
            this._date = new Date(value * 1000);
        } else if (value === null) {
            this._date = null;
        }
    }

    toJSON() {
        return {
            id: this.id,
            mood: this.mood,
            date: this._date ? Math.floor(this._date.getTime() / 1000) : null,
            vintage: this.vintage,
            name: this.name,
            note: this.note,
            latitude: this.latitude,
            longitude: this.longitude,
            language: this.language,
            template: this.template,
            people: this.people,
            place: this.place,
            meals: this.meals,
            comments: this.comments,
            image: {
                id: this.image?.id ?? null,
                base64: this.image?.base64 ?? null,
                filename: this.image?.filename ?? null
            },
            color: this.color
            ? {
                r: this.color.r ?? null,
                g: this.color.g ?? null,
                b: this.color.b ?? null
            }
            : null,
            wineId: this.wineId,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Rack extends Model {
    static GRID_LABEL = Object.freeze({
        NONE: 0,
        BOTH_LETTER: 2,
        BOTH_NUMERIC: 4,
        X_LETTER_Y_NUMBER: 8,
        X_NUMBER_Y_LETTER: 16
    });

    static GRID_DIRECTION = Object.freeze({
        DEFAULT: 1,
        REVERSE_X: 2,
        REVERSE_Y: 3,
        REVERSE_XY: 4
    });

    static GRID_SIZE_MODE = Object.freeze({
        DEFAULT: 1
    });

    _assign(data) {
        super._assign(data);

        this.rows = typeof data.rows === "number"
            ? data.rows
            : null;

        this.columns = typeof data.columns === "number"
            ? data.columns
            : null;

        this.model = typeof data.model === "string"
            ? data.model
            : null;

        this.comments = typeof data.comments === "string"
            ? data.comments
            : null;

        this.gridLabel = typeof data.legend === "number"
            ? data.legend
            : Rack.GRID_LABEL.BOTH_LETTER;

        this.gridDirection = typeof data.naming === "number"
            ? data.naming
            : Rack.GRID_DIRECTION.DEFAULT;

        this.gridSizeMode = typeof data.sizeMode === "number"
            ? data.sizeMode
            : Rack.GRID_SIZE_MODE.DEFAULT;

        this.gridCustomNaming = typeof data.customNaming === "object"
            ? new RackCustomNaming(data.customNaming)
            : null;

        this.rackItems = data.rackItems && Array.isArray(data.rackItems)
            ? data.rackItems.map(rackItem => new RackItem(rackItem))
            : null;

        this.intervals = data.intervals && Array.isArray(data.intervals)
            ? data.intervals.map(interval => new RackInterval(interval))
            : null;
    }

    getRackItem(row, column) {
        if (!this.rackItems) {
            return null;
        }

        return this.rackItems.find(
            item => item.row === row && item.column === column
        ) || null;
    }

    addRackItemAt(row, column, wine = null) {
        if (!this.isValidPosition(row, column)) {
            throw new SDKError(
                SDK_ERROR_CODES.INVALID_PARAMS,
                "Invalid position : row and column must be within rack bounds"
            );
        }

        let rackItem = this.getRackItem(row, column);

        if (rackItem) {
            if (wine) {
                rackItem.wine = wine;
            }
         
            return rackItem;
        }

        if (!this.rackItems) {
            this.rackItems = [];
        }

        rackItem = new RackItem({ row, column });
        rackItem.display = RackItem.DISPLAY.DEFAULT;
        rackItem.shape = RackItem.SHAPE.ROUND;
        rackItem.contentAlignment = RackItem.CONTENT_ALIGNMENT.MIDDLE_CENTER;
        rackItem.wine = wine;
        rackItem.rack = this;
        this.rackItems.push(rackItem);

        return rackItem;
    }

    findRackItemByQrCode(qrCode) {
        if (!qrCode || !this.rackItems) {
            return null;
        }

        return this.rackItems.find(item => item.qrCode === qrCode) || null;
    }

    findRackItemByTag(tag) {
        if (!tag || !this.rackItems) {
            return null;
        }

        return this.rackItems.find(item => item.tags?.includes(tag)) || null;
    }

    populateRackItems() {
        for (let row = 0; row < this.rows; row++) {
            for (let column = 0; column < this.columns; column++) {
                if (this.getRackItem(row, column)) {
                    continue;
                }

                this.addRackItemAt(row, column);
            }
        }

        return this;
    }

    isValidPosition(row, column) {
        return row >= 0 && row < this.rows
            && column >= 0 && column < this.columns;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            rows: this.rows,
            columns: this.columns,
            model: this.model,
            comments: this.comments,
            legend: this.gridLabel,
            naming: this.gridDirection,
            sizeMode: this.gridSizeMode,
            customNaming: this.gridCustomNaming ? {
                x: this.gridCustomNaming.x,
                y: this.gridCustomNaming.y
            } : null,
            rackItems: this.rackItems ? this.rackItems.map(item => item.toJSON()) : null,
            intervals: this.intervals ? this.intervals.map(interval => ({
                type: interval.type,
                value: interval.value
            })) : null,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class RackCustomNaming {
    constructor(data = {}) {
        this.x = typeof data.x === "number"
            ? data.x
            : null;

        this.y = typeof data.y === "number"
            ? data.y
            : null;
    }
}

class RackInterval {
    static TYPE = Object.freeze({
        ROW: 0,
        COLUMN: 1
    });

    constructor(data = {}) {
        this.type = typeof data.type === "number"
            ? data.type
            : null;

        this.value = typeof data.value === "number"
            ? data.value
            : null;
    }
}

class RackItem {
    static DISPLAY = Object.freeze({
        DEFAULT: 0,
        SMALL: 1,
        LARGE: 2
    });

    static SHAPE = Object.freeze({
        ROUND: 0,
        SQUARE: 1,
        HEXAGON: 2,
        BOX: 3,
        CUSTOM: 254
    });

    static CONTENT_ALIGNMENT = Object.freeze({
        TOP_LEFT: 0,
        TOP_CENTER: 1,
        TOP_RIGHT: 2,
        MIDDLE_LEFT: 3,
        MIDDLE_CENTER: 4,
        MIDDLE_RIGHT: 5,
        BOTTOM_LEFT: 6,
        BOTTOM_CENTER: 7,
        BOTTOM_RIGHT: 8
    });

    constructor(data = {}) {
        this.id = typeof data.id === "string"
            ? data.id
            : null;

        this.tags = typeof data.tags === "string"
            ? data.tags
            : null;

        this.qrCode = typeof data.qrCode === "string"
            ? data.qrCode
            : null;

        this.timestamp = typeof data.timestamp === "number"
            ? data.timestamp
            : null;

        this.row = typeof data.row === "number"
            ? data.row
            : null;

        this.column = typeof data.column === "number"
            ? data.column
            : null;
        
        this.contentAlignment = typeof data.contentAlignment === "number"
            ? data.contentAlignment
            : RackItem.CONTENT_ALIGNMENT.MIDDLE_CENTER;

        this.shape = typeof data.shape === "number"
            ? data.shape
            : RackItem.SHAPE.ROUND;

        this.display = typeof data.display === "number"
            ? data.display
            : RackItem.DISPLAY.DEFAULT;

        this.rack = null;

        if (data.rack && typeof data.rack === "object") {
            this.rack = new Rack(data.rack);
        }

        this.wine = null;

        if (data.wine && typeof data.wine === "object") {
            this.wine = new Wine(data.wine);
        }

        this.deleted = false;
    }

    markDeleted() {
        this.deleted = true;
        return this;
    }

    unmarkDeleted() {
        this.deleted = false;
        return this;
    }

    toggleDeleted() {
        this.deleted = !this.deleted;
        return this;
    }

    isEmpty() {
        return this.wine === null;
    }

    isNotEmpty() {
        return !this.isEmpty();
    }

    isDeleted() {
        return this.deleted === true;
    }

    async consume() {
        this._validateId();

        const data = await _gateway.send(`consumeWine`, {
            id: this.id
        });

        console.log("consumeWine response :", data);

        if (!data?.success) {
            throw new SDKError(
                SDK_ERROR_CODES.INTERNAL_ERROR,
                "Failed to consume wine in rack item"
            );
        }

        this.wine = null;

        return this;
    }

    async store(wine) {
        this._validateId();
        
        if (!(wine instanceof Wine) || !wine.id) {
            throw new SDKError(
                SDK_ERROR_CODES.INVALID_PARAMS,
                "Invalid parameter : wine must be a valid Wine instance with an id"
            );
        }

        const data = await _gateway.send(`storeWine`, {
            id: this.id,
            wineId: wine.id
        });

        if (!data?.success) {
            throw new SDKError(
                SDK_ERROR_CODES.INTERNAL_ERROR,
                "Failed to store wine in rack item"
            );
        }

        this.wine = wine;

        return this;
    }

    _validateId() {
        if (!this.id) {
            throw new SDKError(
                SDK_ERROR_CODES.INVALID_PARAMS,
                "Invalid rack item id"
            );
        }
    }

    toJSON() {
        return {
            id: this.id,
            tags: this.tags,
            qrCode: this.qrCode,
            row: this.row,
            column: this.column,
            contentAlignment: this.contentAlignment,
            shape: this.shape,
            display: this.display,
            deleted: this.deleted,
            rack: this.rack ? {
                id: this.rack.id,
                name: this.rack.name
            } : null,
            wine: this.wine ? {
                id: this.wine.id,
                name: this.wine.name
            } : null,
            timestamp: this.timestamp,
            timeCreated: this.timeCreated,
            timeLastModified: this.timeLastModified,
        };
    }
}

class Collection {
    constructor(items = []) {
        this._items = Array.isArray(items) ? items : [];
    }

    [Symbol.iterator]() {
        let index = 0;
        const items = this._items;

        return {
            next() {
                if (index < items.length) {
                    return { value: items[index++], done: false };
                }
                return { done: true };
            }
        };
    }

    forEach(callback) {
        this._items.forEach(callback);
        return this;
    }

    map(callback) {
        return new Collection(this._items.map(callback));
    }

    filter(callback) {
        return new Collection(this._items.filter(callback));
    }

    filterBy(prop, value, options = {}) {
        const { ignoreCase = false, mode = "equals" } = options;

        if (!ignoreCase && mode === "equals") {
            return new Collection(
                this._items.filter(item => this._resolve(item, prop) === value)
            );
        }

        return new Collection(
            this._items.filter(item => {
                const resolved = this._resolve(item, prop);

                if (typeof resolved !== "string" || typeof value !== "string") {
                    return false;
                }

                const a = ignoreCase ? resolved.toLocaleLowerCase() : resolved;
                const b = ignoreCase ? value.toLocaleLowerCase() : value;

                return mode === "startsWith" ? a.startsWith(b) : a === b;
            })
        );
    }

    find(prop, value) {
        return this._items.find(
            item => this._resolve(item, prop) === value
        );
    }

    sortBy(prop, direction = "asc") {
        const dir = String(direction).toLowerCase() === "desc" ? -1 : 1;

        const sorted = [...this._items].sort((a, b) => {
            const valA = this._resolve(a, prop);
            const valB = this._resolve(b, prop);

            if (valA == null && valB == null) {
                return 0;
            }

            if (valA == null) {
                return 1;
            }

            if (valB == null) {
                return -1;
            }

            if (valA < valB) {
                return -1 * dir;
            }

            if (valA > valB) {
                return 1 * dir;
            }

            return 0;
        });

        return new Collection(sorted);
    }

    get count() {
        return this._items.length;
    }

    get isEmpty() {
        return this._items.length === 0;
    }

    get first() {
        return this._items.length ? this._items[0] : undefined;
    }

    get last() {
        return this._items.length
            ? this._items[this._items.length - 1]
            : undefined;
    }

    at(index) {
        if (typeof index !== "number") {
            return undefined;
        }

        if (index < 0) {
            index = this._items.length + index;
        }

        return this._items[index];
    }

    toArray() {
        return [...this._items];
    }

    _resolve(item, prop) {
        if (!item || typeof prop !== "string") {
            return undefined;
        }

        const keys = prop.includes(".") ? prop.split(".") : [prop];

        return keys.reduce((obj, key) => obj?.[key], item);
    }
}

SDK.version = "1.0.0";
SDK.versionCode = 1;
SDK.logger = _logger;

globalThis.Authorization = Authorization;
globalThis.SDK = SDK;
globalThis.Collection = Collection;
globalThis.Country = Country;
globalThis.Region = Region;
globalThis.Appellation = Appellation;
globalThis.Classification = Classification;
globalThis.Grape = Grape;
globalThis.Color = Color;
globalThis.BottleFormat = BottleFormat;
globalThis.Owner = Owner;
globalThis.Vendor = Vendor;
globalThis.Contact = Contact;
globalThis.Parameter = Parameter;
globalThis.Rack = Rack;
globalThis.RackItem = RackItem;
globalThis.Wine = Wine;
globalThis.Order = Order;
globalThis.Document = Document;
globalThis.TastingNotes = TastingNotes;
globalThis.Period = Period;
globalThis.RackInterval = RackInterval;