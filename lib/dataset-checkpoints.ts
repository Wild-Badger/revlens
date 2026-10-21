import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, realpath, rename, stat } from "node:fs/promises";
import path from "node:path";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class CheckpointError extends Error {}

async function directory() {
  const runtime = process.env.REV_ANALYTICS_RUNTIME;
  if (!runtime || !path.isAbsolute(runtime)) throw new CheckpointError("An absolute private REV_ANALYTICS_RUNTIME is required before replacing data");
  const relativeRuntime = path.relative(process.cwd(), path.resolve(runtime));
  if (!relativeRuntime || (!relativeRuntime.startsWith(`..${path.sep}`) && relativeRuntime !== ".." && !path.isAbsolute(relativeRuntime))) throw new CheckpointError("Checkpoints must be outside the repository and public assets");
  const dir = path.join(runtime, "checkpoints");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const resolved = await realpath(dir), repo = await realpath(process.cwd());
  const relative = path.relative(repo, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new CheckpointError("Checkpoints must be outside the repository and public assets");
  return resolved;
}

export async function saveCheckpoint(backup: unknown, revision: number, reason: "restore" | "new-source") {
  const dir = await directory(), id = randomUUID();
  const envelope = { format: "revlens-checkpoint", schemaVersion: 1, id, createdAt: new Date().toISOString(), revision, reason, checksum: checksum(backup), backup };
  // ponytail: files are retained indefinitely; operator-managed archival is the upgrade path for disk limits.
  const temporary = path.join(dir, `${id}.partial`), target = path.join(dir, `${id}.json`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(envelope)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
  // Windows does not expose directory fsync. The completed file itself is always fsynced before deletion of records.
  if (process.platform !== "win32") { const folder = await open(dir, "r"); try { await folder.sync(); } finally { await folder.close(); } }
  return id;
}

export async function checkpointFile(id: string) {
  if (!ID.test(id)) throw new CheckpointError("Invalid checkpoint ID");
  return path.join(await directory(), `${id}.json`);
}

export function unwrapCheckpoint(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== "revlens-checkpoint") return value;
  const item = value as Record<string, unknown>;
  if (!item.backup || typeof item.backup !== "object" || Array.isArray(item.backup)) throw new CheckpointError("Checkpoint backup payload is required");
  if (Object.keys(item).some(key => !["format", "schemaVersion", "id", "createdAt", "revision", "reason", "checksum", "backup"].includes(key))) throw new CheckpointError("Unexpected checkpoint fields");
  if (item.schemaVersion !== 1 || typeof item.id !== "string" || !ID.test(item.id) || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isInteger(item.revision) || Number(item.revision) < 0 || !["restore", "new-source"].includes(String(item.reason)) || item.checksum !== checksum(item.backup)) throw new CheckpointError("Invalid checkpoint format or checksum; keep the file for manual recovery");
  return item.backup;
}

export async function listCheckpoints() {
  const dir = await directory();
  const files = (await readdir(dir)).filter(name => name.endsWith(".json") && ID.test(name.slice(0, -5)));
  return Promise.all(files.map(async name => { const info = await stat(path.join(dir, name)); return { id: name.slice(0, -5), bytes: info.size, savedAt: info.mtime.toISOString() }; })).then(items => items.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
}
