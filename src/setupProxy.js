/**
 * Explicit /api → backend proxy for Create React App (more reliable than package.json "proxy" alone).
 * Target matches default API_BASE in development (backend/server.js on port 5000).
 */
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function setupProxy(app) {
  const target = process.env.REACT_APP_PROXY_TARGET || "http://127.0.0.1:5000";
  app.use(
    "/api",
    createProxyMiddleware({
      target,
      changeOrigin: true,
      secure: false,
    })
  );
};
