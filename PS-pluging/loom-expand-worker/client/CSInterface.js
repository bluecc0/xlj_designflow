function CSInterface() {}

CSInterface.prototype.hostEnvironment = window.__adobe_cep__
  ? JSON.parse(window.__adobe_cep__.getHostEnvironment())
  : null;

CSInterface.prototype.getHostEnvironment = function () {
  return this.hostEnvironment;
};

CSInterface.prototype.evalScript = function (script, callback) {
  if (callback === null || callback === undefined) {
    callback = function () {};
  }
  window.__adobe_cep__.evalScript(script, callback);
};
