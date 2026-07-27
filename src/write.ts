import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PendingWrite {
  content: string;
  mode?: number;
  target: string;
}

interface StagedWrite extends PendingWrite {
  temporaryPath: string;
}

export async function writeBatch(writes: readonly PendingWrite[]): Promise<void> {
  assertDistinctTargets(writes);
  const staged: StagedWrite[] = [];

  try {
    for (const write of writes) staged.push(await stageWrite(write));
    for (const write of staged) await rename(write.temporaryPath, write.target);
  } catch (error) {
    await Promise.allSettled(staged.map((write) => unlink(write.temporaryPath)));
    throw error;
  }
}

export async function readMode(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mode;
  } catch {
    return undefined;
  }
}

async function stageWrite(write: PendingWrite): Promise<StagedWrite> {
  await mkdir(path.dirname(write.target), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(write.target),
    `.${path.basename(write.target)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await writeFile(temporaryPath, write.content, { flag: "wx", mode: write.mode });
  if (write.mode !== undefined) await chmod(temporaryPath, write.mode);
  return { ...write, temporaryPath };
}

function assertDistinctTargets(writes: readonly PendingWrite[]): void {
  const targets = new Set<string>();

  for (const write of writes) {
    if (targets.has(write.target)) throw new Error(`Multiple outputs resolve to ${write.target}`);
    targets.add(write.target);
  }
}
