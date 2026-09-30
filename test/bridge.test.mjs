import assert from "node:assert/strict";
import { test } from "node:test";

import { BRIDGE_TOOLS, executeBridgeTool, resolveRunContext } from "../src/bridge-core.mjs";

test("bridge exposes only the three native plugin tools", () => {
  assert.deepEqual(BRIDGE_TOOLS.map(({ name }) => name), [
    "savantis_memory_policy",
    "savantis_memory_recall",
    "savantis_memory_retain",
  ]);
});

test("bridge declares read and write safety annotations", () => {
  assert.deepEqual(BRIDGE_TOOLS.map(({ name, annotations }) => ({ name, annotations })), [
    {
      name: "savantis_memory_policy",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "savantis_memory_recall",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "savantis_memory_retain",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ]);
});

test("bridge rejects missing run context before contacting Paperclip", async () => {
  let contacted = false;
  await assert.rejects(resolveRunContext({ PAPERCLIP_API_URL: "https://paperclip.example" }, async () => {
    contacted = true;
  }), /PAPERCLIP_API_KEY/);
  assert.equal(contacted, false);
});

test("bridge rejects unlisted tools before contacting Paperclip", async () => {
  let contacted = false;
  await assert.rejects(executeBridgeTool("delete_everything", {}, {
    env: {
      PAPERCLIP_API_URL: "https://paperclip.example",
      PAPERCLIP_API_KEY: "jwt",
      PAPERCLIP_AGENT_ID: "agent",
      PAPERCLIP_RUN_ID: "run",
      PAPERCLIP_COMPANY_ID: "company",
      PAPERCLIP_MEMORY_PROJECT_ID: "project",
    },
    fetch: async () => { contacted = true; },
  }), /Unknown memory tool/);
  assert.equal(contacted, false);
});

test("bridge relays the native tool with complete run context", async () => {
  let request;
  const result = await executeBridgeTool("savantis_memory_recall", { query: "preferences" }, {
    env: {
      PAPERCLIP_API_URL: "https://paperclip.example/",
      PAPERCLIP_API_KEY: "jwt",
      PAPERCLIP_AGENT_ID: "agent",
      PAPERCLIP_RUN_ID: "run",
      PAPERCLIP_COMPANY_ID: "company",
      PAPERCLIP_MEMORY_PROJECT_ID: "project",
    },
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ result: { content: "ok", data: { untrusted: true } } }), { status: 200 });
    },
  });
  assert.equal(request.url, "https://paperclip.example/api/plugins/tools/execute");
  assert.deepEqual(JSON.parse(request.init.body), {
    tool: "paperclip.savantis-memory:recall",
    parameters: { query: "preferences" },
    runContext: { agentId: "agent", runId: "run", companyId: "company", projectId: "project" },
  });
  assert.deepEqual(result, { content: "ok", data: { untrusted: true } });
});

test("task project takes precedence over the chat fallback project", async () => {
  const context = await resolveRunContext({
    PAPERCLIP_API_URL: "https://paperclip.example",
    PAPERCLIP_API_KEY: "jwt",
    PAPERCLIP_AGENT_ID: "agent",
    PAPERCLIP_RUN_ID: "run",
    PAPERCLIP_COMPANY_ID: "company",
    PAPERCLIP_TASK_ID: "issue-1",
    PAPERCLIP_MEMORY_PROJECT_ID: "chat-project",
  }, async () => new Response(JSON.stringify({ projectId: "task-project" }), { status: 200 }));
  assert.equal(context.projectId, "task-project");
});

test("bridge reports upstream status without echoing private response bodies", async () => {
  await assert.rejects(executeBridgeTool("savantis_memory_policy", {}, {
    env: {
      PAPERCLIP_API_URL: "https://paperclip.example",
      PAPERCLIP_API_KEY: "jwt",
      PAPERCLIP_AGENT_ID: "agent",
      PAPERCLIP_RUN_ID: "run",
      PAPERCLIP_COMPANY_ID: "company",
      PAPERCLIP_MEMORY_PROJECT_ID: "project",
    },
    fetch: async () => new Response("private upstream body", { status: 502 }),
  }), (error) => error.message === "Paperclip tool request failed (502)");
});
