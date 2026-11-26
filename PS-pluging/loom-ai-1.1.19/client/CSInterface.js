/**
 * CSInterface - v9.4.0 (Loom AI 扩展精简版)
 * 支持 evalScript 与 Photoshop 原生事件监听（CSEvent / addEventListener / dispatchEvent）。
 */

function CSEvent(type, scope, appId, extensionId) {
  this.type = type;
  this.scope = scope;
  this.appId = appId;
  this.extensionId = extensionId;
  this.data = "";
}

function CSInterface() {}

CSInterface.prototype.hostEnvironment = window.__adobe_cep__
  ? JSON.parse(window.__adobe_cep__.getHostEnvironment())
  : null;

CSInterface.prototype.getHostEnvironment = function () {
  return this.hostEnvironment;
};

CSInterface.prototype.closeExtension = function () {
  if (window.__adobe_cep__) {
    window.__adobe_cep__.closeExtension();
  }
};

CSInterface.prototype.getSystemPath = function (pathType) {
  var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
  var OSVersion = this.getOSInformation();
  if (OSVersion.indexOf("Windows") >= 0) {
    path = path.replace("file:///", "");
  } else if (OSVersion.indexOf("Mac") >= 0) {
    path = path.replace("file://", "");
  }
  return path;
};

CSInterface.prototype.evalScript = function (script, callback) {
  if (callback === null || callback === undefined) {
    callback = function () {};
  }
  window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getApplicationID = function () {
  return this.hostEnvironment ? this.hostEnvironment.appId : "";
};

CSInterface.prototype.getExtensionID = function () {
  return window.__adobe_cep__ && typeof window.__adobe_cep__.getExtensionId === "function"
    ? window.__adobe_cep__.getExtensionId()
    : "";
};

CSInterface.prototype.addEventListener = function (type, listener, obj) {
  if (window.__adobe_cep__ && typeof window.__adobe_cep__.addEventListener === "function") {
    window.__adobe_cep__.addEventListener(type, listener, obj);
  }
};

CSInterface.prototype.removeEventListener = function (type, listener, obj) {
  if (window.__adobe_cep__ && typeof window.__adobe_cep__.removeEventListener === "function") {
    window.__adobe_cep__.removeEventListener(type, listener, obj);
  }
};

CSInterface.prototype.dispatchEvent = function (event) {
  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.dispatchEvent !== "function") {
    return;
  }
  if (typeof event.data === "object") {
    event.data = JSON.stringify(event.data);
  }
  window.__adobe_cep__.dispatchEvent(event);
};

CSInterface.prototype.getOSInformation = function () {
  if (navigator.platform === "Win32" || navigator.platform === "Windows") {
    return "Windows";
  }
  if (
    navigator.platform === "Mac68K" ||
    navigator.platform === "MacPPC" ||
    navigator.platform === "Macintosh" ||
    navigator.platform === "MacIntel"
  ) {
    return "Mac";
  }
  return "Unknown";
};

var SystemPath = {
  USER_DATA: "userData",
  COMMON_FILES: "commonFiles",
  MY_DOCUMENTS: "myDocuments",
  APPLICATION: "application",
  EXTENSION: "extension",
  HOST_APPLICATION: "hostApplication"
};
