import { randomBytes } from "node:crypto";

export const MCP_URL = "https://context.savantisai.com/mcp";
const SCOPE = "context:read context:write";

function redirectUrl(publicBaseUrl) {
  const base = new URL(publicBaseUrl);
  const localHttp = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.protocol !== "https:" && !localHttp) throw new Error("publicBaseUrl must use HTTPS, except on loopback hosts");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/savantis-memory`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export async function beginAuthorization(store, publicBaseUrl, sdk, options = {}) {
  const now = options.now ?? Date.now();
  const state = options.state ?? randomBytes(32).toString("base64url");
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const redirect = redirectUrl(publicBaseUrl);
  const saved = await store.load();
  const metadata = await sdk.discoverAuthorizationServerMetadata(MCP_URL);
  if (!metadata) throw new Error("Savantis OAuth discovery failed");
  const clientInformation = saved.clientInformation && saved.clientRedirectUrl === redirect
    ? saved.clientInformation
    : await sdk.registerClient(MCP_URL, {
    metadata,
    clientMetadata: {
      client_name: "Paperclip Savantis Memory",
      redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    },
    scope: SCOPE,
    });
  const started = await sdk.startAuthorization(MCP_URL, {
    metadata,
    clientInformation,
    redirectUrl: redirect,
    scope: SCOPE,
    state,
    resource: new URL(MCP_URL),
  });
  await store.merge({
    pendingAuthorization: {
      state,
      codeVerifier: started.codeVerifier,
      redirect,
      clientInformation,
      clientRedirectUrl: redirect,
      expiresAt: now + ttlMs,
      consumed: false,
    },
  });
  return { authorizationUrl: started.authorizationUrl.toString() };
}

export async function finishAuthorization(store, { code, state }, sdk, options = {}) {
  if (!code || !state) throw new Error("OAuth code and state are required");
  const now = options.now ?? Date.now();
  const saved = await store.load();
  const pending = saved.pendingAuthorization;
  if (!pending || pending.state !== state) throw new Error("OAuth state mismatch");
  if (pending.consumed) throw new Error("OAuth state already used");
  if (now > pending.expiresAt) throw new Error("OAuth state expired");

  await store.merge({ pendingAuthorization: { ...pending, consumed: true } });
  const metadata = await sdk.discoverAuthorizationServerMetadata(MCP_URL);
  if (!metadata) throw new Error("Savantis OAuth discovery failed");
  const tokens = await sdk.exchangeAuthorization(MCP_URL, {
    metadata,
    clientInformation: pending.clientInformation ?? saved.clientInformation,
    authorizationCode: code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirect,
    resource: new URL(MCP_URL),
  });
  await store.merge({
    clientInformation: pending.clientInformation ?? saved.clientInformation,
    clientRedirectUrl: pending.clientRedirectUrl ?? pending.redirect,
    tokens,
  }, { replaceTokens: true });
  return { connected: true };
}

export class StoredOAuthProvider {
  #authorizationUrl;
  #store;

  constructor(store, publicBaseUrl) {
    this.#store = store;
    this.redirectUrl = redirectUrl(publicBaseUrl);
  }

  get clientMetadata() {
    return {
      client_name: "Paperclip Savantis Memory",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    };
  }

  async clientInformation() { return (await this.#store.load()).clientInformation; }
  async saveClientInformation(value) { await this.#store.merge({ clientInformation: value }); }
  async tokens() { return (await this.#store.load()).tokens; }
  async saveTokens(value) { await this.#store.merge({ tokens: value }); }
  async redirectToAuthorization(url) { this.#authorizationUrl = url.toString(); }
  async saveCodeVerifier(value) { await this.#store.merge({ codeVerifier: value }); }
  async codeVerifier() {
    const value = (await this.#store.load()).codeVerifier;
    if (!value) throw new Error("OAuth code verifier is missing");
    return value;
  }
  get authorizationUrl() { return this.#authorizationUrl; }
}
