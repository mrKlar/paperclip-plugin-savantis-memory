const PAPERCLIP_SPACE = {
  name: "Paperclip",
  description: "Durable memories retained by Paperclip agents.",
  visibility: "private",
};
const CREDENTIAL = /(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,}|\bsk[_-][A-Za-z0-9_-]{16,}/i;

export function assertCompany(actual, configured) {
  if (!configured || actual !== configured) throw new Error("Company scope mismatch");
}

function requireText(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} must be 1-${max} characters`);
}

function retentionInput(input) {
  requireText(input.title, "title", 200);
  requireText(input.body, "body", 65_536);
  if (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some((tag) => typeof tag !== "string" || !tag || tag.length > 40)) throw new Error("tags are invalid");
  if (!["none", "personal", "sensitive"].includes(input.sensitivity)) throw new Error("sensitivity is invalid");
  if (CREDENTIAL.test([input.title, input.body, ...input.tags].join("\n"))) throw new Error("Credentials must never be retained");
  return { ...input, confirmed: input.confirmed === true };
}

function policyOf(result) {
  const policy = result?.policy;
  if (!policy || typeof policy !== "object") throw new Error("Savantis returned no memory policy");
  return policy;
}

export async function recall(call, input) {
  requireText(input.query, "query", 2_048);
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("limit must be 1-25");
  const policy = policyOf(await call("savantis_get_memory_policy", {}));
  if (!["automatic", "explicit", "disabled"].includes(policy.recall?.mode)) {
    throw new Error("Unsupported recall policy");
  }
  if (policy.recall?.mode === "disabled") return { status: "disabled", policy };
  if (policy.recall?.mode === "explicit" && input.requestedByUser !== true) return { status: "confirmation_required", policy };
  const data = await call("savantis_recall", {
    query: input.query.trim(),
    limit,
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    requestedByUser: input.requestedByUser === true,
  });
  return { ...data, untrusted: true };
}

async function paperclipSpace(call) {
  const listed = await call("savantis_list_spaces", {});
  const spaces = Array.isArray(listed?.spaces) ? listed.spaces : [];
  const existing = spaces.find((space) => String(space?.name).trim().toLocaleLowerCase() === "paperclip");
  if (existing) {
    if (existing.visibility && existing.visibility !== "private") throw new Error("Existing Paperclip space is not private");
    return existing;
  }
  const created = await call("savantis_create_space", PAPERCLIP_SPACE);
  if (!created?.space) throw new Error("Savantis did not return a Paperclip space");
  return created.space;
}

function operationId(result) {
  return result?.operationId ?? result?.operation?.id ?? result?.operation?.operationId;
}

function durableResult(result) {
  if (result?.durable === true && result?.memoryId) return { memoryId: result.memoryId };
  const operation = result?.operation;
  if (["completed", "succeeded", "success", "durable"].includes(operation?.status) && (result?.memoryId || operation?.memoryId)) {
    return { memoryId: result.memoryId ?? operation.memoryId };
  }
  if (["failed", "error"].includes(operation?.status)) throw new Error("Savantis retention failed");
  return null;
}

export async function retain(call, rawInput, options = {}) {
  const policy = policyOf(await call("savantis_get_memory_policy", {}));
  const input = retentionInput(rawInput);
  const mode = policy.retention?.mode;
  if (!["propose", "automatic_non_sensitive", "automatic_all", "explicit", "disabled"].includes(mode)) {
    throw new Error("Unsupported retention policy");
  }
  if (mode === "disabled") return { status: "disabled", policy };
  const proposal = await call("savantis_propose_memory", {
    title: input.title,
    body: input.body,
    tags: input.tags,
    sensitivity: input.sensitivity,
  });
  if (!input.confirmed && (mode === "propose" || mode === "explicit" || input.sensitivity === "sensitive" || proposal?.confirmationRequired !== false)) {
    return { status: "confirmation_required", policy, proposal: proposal?.proposal };
  }

  const space = await paperclipSpace(call);
  const spaceId = space.id ?? space.spaceId;
  if (!spaceId) throw new Error("Paperclip space has no id");
  let retained = await call("savantis_confirm_memory", input);
  let durable = durableResult(retained);
  const pendingId = operationId(retained);
  const attempts = options.pollAttempts ?? 3;
  const delay = options.pollDelayMs ?? 250;
  for (let attempt = 0; !durable && pendingId && attempt < attempts; attempt += 1) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    retained = await call("savantis_get_memory_operation", { operationId: pendingId });
    durable = durableResult(retained);
  }
  if (!durable) {
    if (pendingId) return { status: "pending", operationId: pendingId };
    throw new Error("Savantis returned neither a durable memory nor an operation id");
  }
  await call("savantis_link_memory_to_space", { memoryId: durable.memoryId, spaceId });
  return { status: "stored", durable: true, memoryId: durable.memoryId, spaceId };
}
