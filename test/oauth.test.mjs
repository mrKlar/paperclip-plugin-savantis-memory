import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CredentialStore } from "../src/credential-store.mjs";
import { beginAuthorization, finishAuthorization, StoredOAuthProvider } from "../src/oauth.mjs";

test("OAuth permits HTTP only for local development loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(new StoredOAuthProvider({}, `http://${host}:3100/NIC`).redirectUrl, `http://${host}:3100/NIC/savantis-memory`);
  }
  assert.throws(() => new StoredOAuthProvider({}, "http://localhost.example/NIC"), /HTTPS/);
});

test("OAuth rejects insecure remote redirects before contacting Savantis", async () => {
  let contacted = false;
  await assert.rejects(beginAuthorization({ load: async () => ({}) }, "http://paperclip.example/NIC", {
    discoverAuthorizationServerMetadata: async () => { contacted = true; },
  }), /HTTPS/);
  assert.equal(contacted, false);
});

test("OAuth state expires and is consumed exactly once", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-oauth-test-"));
  const store = new CredentialStore("company-a", home);
  const sdk = {
    discoverAuthorizationServerMetadata: async () => ({ issuer: "https://context.savantisai.com", authorization_endpoint: "https://context.savantisai.com/authorize", token_endpoint: "https://context.savantisai.com/oauth/token", registration_endpoint: "https://context.savantisai.com/oauth/register" }),
    registerClient: async () => ({ client_id: "public-client", token_endpoint_auth_method: "none" }),
    startAuthorization: async (_url, { state }) => ({ authorizationUrl: new URL(`https://context.savantisai.com/authorize?state=${state}`), codeVerifier: "verifier" }),
    exchangeAuthorization: async () => ({ access_token: "access", refresh_token: "refresh", token_type: "bearer" }),
  };
  const started = await beginAuthorization(store, "https://paperclip.example/plugins/paperclip.savantis-memory", sdk, { now: 1000, state: "state-1" });
  assert.match(started.authorizationUrl, /state=state-1/);

  await finishAuthorization(store, { code: "code-1", state: "state-1" }, sdk, { now: 1001 });
  await assert.rejects(finishAuthorization(store, { code: "code-2", state: "state-1" }, sdk, { now: 1002 }), /already used/i);
  assert.equal((await store.load()).tokens.access_token, "access");
});

test("OAuth callback rejects mismatched and expired state before token exchange", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-oauth-test-"));
  const store = new CredentialStore("company-a", home);
  let exchanges = 0;
  const sdk = {
    discoverAuthorizationServerMetadata: async () => ({ issuer: "https://context.savantisai.com", authorization_endpoint: "https://context.savantisai.com/authorize", token_endpoint: "https://context.savantisai.com/oauth/token", registration_endpoint: "https://context.savantisai.com/oauth/register" }),
    registerClient: async () => ({ client_id: "public-client", token_endpoint_auth_method: "none" }),
    startAuthorization: async (_url, { state }) => ({ authorizationUrl: new URL(`https://context.savantisai.com/authorize?state=${state}`), codeVerifier: "verifier" }),
    exchangeAuthorization: async () => { exchanges += 1; return { access_token: "access", token_type: "bearer" }; },
  };
  await beginAuthorization(store, "https://paperclip.example/plugins/paperclip.savantis-memory", sdk, { now: 1000, state: "state-1", ttlMs: 10 });

  await assert.rejects(finishAuthorization(store, { code: "code", state: "wrong" }, sdk, { now: 1001 }), /state mismatch/i);
  await assert.rejects(finishAuthorization(store, { code: "code", state: "state-1" }, sdk, { now: 1011 }), /expired/i);
  assert.equal(exchanges, 0);
});

test("OAuth preserves the company prefix and re-registers a client for a changed redirect", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-oauth-test-"));
  const store = new CredentialStore("company-a", home);
  await store.merge({
    clientInformation: { client_id: "old-client" },
    clientRedirectUrl: "https://paperclip.example/OLD/savantis-memory",
    tokens: { access_token: "existing", refresh_token: "refresh", token_type: "bearer" },
  });
  let registeredRedirect;
  const sdk = {
    discoverAuthorizationServerMetadata: async () => ({ issuer: "https://context.savantisai.com", authorization_endpoint: "https://context.savantisai.com/authorize", token_endpoint: "https://context.savantisai.com/oauth/token", registration_endpoint: "https://context.savantisai.com/oauth/register" }),
    registerClient: async (_url, options) => {
      registeredRedirect = options.clientMetadata.redirect_uris[0];
      return { client_id: "new-client", token_endpoint_auth_method: "none" };
    },
    startAuthorization: async (_url, { state }) => ({ authorizationUrl: new URL(`https://context.savantisai.com/authorize?state=${state}`), codeVerifier: "verifier" }),
  };

  await beginAuthorization(store, "https://paperclip.example/NIC", sdk, { now: 1000, state: "state-1" });

  assert.equal(registeredRedirect, "https://paperclip.example/NIC/savantis-memory");
  const saved = await store.load();
  assert.equal(saved.clientInformation.client_id, "old-client");
  assert.equal(saved.clientRedirectUrl, "https://paperclip.example/OLD/savantis-memory");
  assert.equal(saved.pendingAuthorization.clientInformation.client_id, "new-client");
  assert.equal(saved.pendingAuthorization.clientRedirectUrl, "https://paperclip.example/NIC/savantis-memory");
  assert.equal(saved.tokens.access_token, "existing");
});

test("failed reauthorization preserves the working client and token pair", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-oauth-test-"));
  const store = new CredentialStore("company-a", home);
  await store.merge({
    clientInformation: { client_id: "old-client" },
    clientRedirectUrl: "https://paperclip.example/OLD/savantis-memory",
    tokens: { access_token: "existing", refresh_token: "old-refresh", token_type: "bearer" },
  });
  const sdk = {
    discoverAuthorizationServerMetadata: async () => ({ issuer: "https://context.savantisai.com", authorization_endpoint: "https://context.savantisai.com/authorize", token_endpoint: "https://context.savantisai.com/oauth/token", registration_endpoint: "https://context.savantisai.com/oauth/register" }),
    registerClient: async () => ({ client_id: "new-client", token_endpoint_auth_method: "none" }),
    startAuthorization: async (_url, { state }) => ({ authorizationUrl: new URL(`https://context.savantisai.com/authorize?state=${state}`), codeVerifier: "verifier" }),
    exchangeAuthorization: async () => { throw new Error("exchange failed"); },
  };
  await beginAuthorization(store, "https://paperclip.example/NIC", sdk, { now: 1000, state: "state-1" });
  await assert.rejects(finishAuthorization(store, { code: "code", state: "state-1" }, sdk, { now: 1001 }), /exchange failed/);
  const saved = await store.load();
  assert.equal(saved.clientInformation.client_id, "old-client");
  assert.equal(saved.tokens.access_token, "existing");
  assert.equal(saved.tokens.refresh_token, "old-refresh");
});

test("successful reauthorization replaces old refresh credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-oauth-test-"));
  const store = new CredentialStore("company-a", home);
  await store.merge({
    clientInformation: { client_id: "old-client" },
    clientRedirectUrl: "https://paperclip.example/OLD/savantis-memory",
    tokens: { access_token: "existing", refresh_token: "old-refresh", token_type: "bearer" },
  });
  const sdk = {
    discoverAuthorizationServerMetadata: async () => ({ issuer: "https://context.savantisai.com", authorization_endpoint: "https://context.savantisai.com/authorize", token_endpoint: "https://context.savantisai.com/oauth/token", registration_endpoint: "https://context.savantisai.com/oauth/register" }),
    registerClient: async () => ({ client_id: "new-client", token_endpoint_auth_method: "none" }),
    startAuthorization: async (_url, { state }) => ({ authorizationUrl: new URL(`https://context.savantisai.com/authorize?state=${state}`), codeVerifier: "verifier" }),
    exchangeAuthorization: async () => ({ access_token: "new-access", token_type: "bearer" }),
  };
  await beginAuthorization(store, "https://paperclip.example/NIC", sdk, { now: 1000, state: "state-1" });
  await finishAuthorization(store, { code: "code", state: "state-1" }, sdk, { now: 1001 });
  const saved = await store.load();
  assert.equal(saved.clientInformation.client_id, "new-client");
  assert.equal(saved.tokens.access_token, "new-access");
  assert.equal(saved.tokens.refresh_token, undefined);
});
