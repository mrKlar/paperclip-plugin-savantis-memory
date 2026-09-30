import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { CredentialStore } from "../src/credential-store.mjs";

test("credential store persists atomically with private permissions and merges refreshes", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-memory-test-"));
  const store = new CredentialStore("company-a", home);
  await store.merge({ clientInformation: { client_id: "public-client" }, tokens: { access_token: "first", token_type: "bearer", refresh_token: "refresh" } });
  await store.merge({ tokens: { access_token: "second", token_type: "bearer" } });

  const saved = await store.load();
  const file = join(home, "plugins", "paperclip.savantis-memory", "credentials", "company-a.json");
  const savedText = await readFile(file, "utf8");
  assert.equal(saved.tokens.access_token, "second");
  assert.equal(saved.tokens.refresh_token, "refresh");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(home, "plugins", "paperclip.savantis-memory", "credentials"))).mode & 0o777, 0o700);
  assert.doesNotThrow(() => JSON.parse(savedText));
});

test("a failed credential write does not poison later writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-memory-test-"));
  await writeFile(join(home, "plugins"), "blocks directory creation");
  const store = new CredentialStore("company-a", home);
  await assert.rejects(store.merge({ tokens: { access_token: "first" } }));
  await rm(join(home, "plugins"));
  await store.merge({ tokens: { access_token: "second" } });
  assert.equal((await store.load()).tokens.access_token, "second");
});

test("credential store falls back beside the installed bundle without PAPERCLIP_HOME", async () => {
  const plugin = await mkdtemp(join(tmpdir(), "savantis-memory-plugin-"));
  const moduleUrl = pathToFileURL(join(plugin, "dist", "worker.js")).href;
  const store = new CredentialStore("company-a", null, moduleUrl);
  await store.merge({ tokens: { access_token: "stored" } });
  const file = join(plugin, "private", "credentials", "company-a.json");
  assert.equal(JSON.parse(await readFile(file, "utf8")).tokens.access_token, "stored");
  assert.equal((await stat(join(plugin, "private", "credentials"))).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("credential stores isolate OAuth tokens and pending state by company", async () => {
  const home = await mkdtemp(join(tmpdir(), "savantis-memory-test-"));
  const companyA = new CredentialStore("company-a", home);
  const companyB = new CredentialStore("company-b", home);

  await companyA.merge({
    tokens: { access_token: "token-a" },
    pendingAuthorization: { state: "state-a" },
  });
  await companyB.merge({
    tokens: { access_token: "token-b" },
    pendingAuthorization: { state: "state-b" },
  });

  assert.deepEqual(await companyA.load(), {
    tokens: { access_token: "token-a" },
    pendingAuthorization: { state: "state-a" },
  });
  assert.deepEqual(await companyB.load(), {
    tokens: { access_token: "token-b" },
    pendingAuthorization: { state: "state-b" },
  });
});

test("credential store rejects unsafe company keys", () => {
  assert.throws(() => new CredentialStore("../company-b", "/tmp/paperclip"), /company/i);
});
