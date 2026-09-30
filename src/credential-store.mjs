import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EMPTY = Object.freeze({});

export class CredentialStore {
  #file;
  #write = Promise.resolve();

  constructor(companyId, paperclipHome = process.env.PAPERCLIP_HOME, moduleUrl = import.meta.url) {
    if (typeof companyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(companyId)) {
      throw new Error("companyId is invalid");
    }
    this.#file = paperclipHome
      ? join(paperclipHome, "plugins", "paperclip.savantis-memory", "credentials", `${companyId}.json`)
      : join(fileURLToPath(new URL("../private/credentials", moduleUrl)), `${companyId}.json`);
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.#file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return { ...EMPTY };
      throw error;
    }
  }

  async merge(patch, options = {}) {
    this.#write = this.#write.catch(() => {}).then(async () => {
      const current = await this.load();
      const next = {
        ...current,
        ...patch,
        ...(patch.tokens ? { tokens: options.replaceTokens ? patch.tokens : { ...current.tokens, ...patch.tokens } } : {}),
      };
      await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 });
      const temporary = `${this.#file}.${process.pid}.tmp`;
      const handle = await open(temporary, "w", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(next)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.#file);
      return next;
    });
    return this.#write;
  }
}
