import { createHash } from "node:crypto";

/**
 * Deciding what may be written, kept apart from the writing.
 *
 * The ownership model is "generate once, then the file is yours" (docs/plan.md
 * §8). So a re-run has to tell a file it wrote and nobody touched (safe to
 * regenerate) from one a person has since edited (never clobbered without
 * `--force`). The manifest is how: it records a hash of what was last written
 * to each path. Everything here is pure — the caller supplies what is on disk
 * and performs the writes — so the rule can be tested without a filesystem.
 */

export type Manifest = Readonly<{
  version: 1;
  /** Path (relative to the project root, forward slashes) → hash of what was written there. */
  files: Readonly<Record<string, string>>;
}>;

export const emptyManifest: Manifest = { version: 1, files: {} };

export const hashOf = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

/** A manifest read from disk is untrusted input: anything malformed reads as "no record". */
export const parseManifest = (text: string | undefined): Manifest => {
  if (text === undefined) return emptyManifest;

  try {
    const parsed = JSON.parse(text) as unknown;
    const files =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Readonly<{ files?: unknown }>).files
        : undefined;

    return typeof files === "object" && files !== null
      ? {
          version: 1,
          files: Object.fromEntries(
            Object.entries(files).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
        }
      : emptyManifest;
  } catch {
    return emptyManifest;
  }
};

export type PendingFile = Readonly<{
  /** Manifest key: relative to the project root, forward slashes. */
  key: string;
  content: string;
  /** What is at that path now, or `undefined` when nothing is. */
  existing: string | undefined;
}>;

export type WritePlan =
  | Readonly<{
      kind: "ready";
      /** Files whose content will change on disk. */
      writes: readonly PendingFile[];
      /** Files already identical to what would be written. */
      unchanged: readonly PendingFile[];
      manifest: Manifest;
    }>
  /** Nothing is written: all-or-nothing, so a half-regenerated form never exists. */
  | Readonly<{ kind: "blocked"; edited: readonly string[] }>;

type Disposition = "create" | "unchanged" | "regenerate" | "edited";

const dispositionOf = (file: PendingFile, manifest: Manifest): Disposition =>
  file.existing === undefined
    ? "create"
    : file.existing === file.content
      ? "unchanged"
      : // Line endings are normalized before hashing: git's autocrlf can rewrite
        // a file's bytes on checkout without anyone having edited it.
        hashOf(normalize(file.existing)) === manifest.files[file.key]
        ? "regenerate"
        : "edited";

const normalize = (content: string): string => content.replace(/\r\n/g, "\n");

export const planWrites = (
  files: readonly PendingFile[],
  manifest: Manifest,
  force: boolean,
): WritePlan => {
  const sorted = files.map((file) => ({ file, disposition: dispositionOf(file, manifest) }));
  const edited = sorted.filter((entry) => entry.disposition === "edited");

  if (edited.length > 0 && !force) {
    return { kind: "blocked", edited: edited.map((entry) => entry.file.key) };
  }

  return {
    kind: "ready",
    writes: sorted.filter((entry) => entry.disposition !== "unchanged").map((entry) => entry.file),
    unchanged: sorted
      .filter((entry) => entry.disposition === "unchanged")
      .map((entry) => entry.file),
    manifest: {
      version: 1,
      files: {
        ...manifest.files,
        ...Object.fromEntries(files.map((file) => [file.key, hashOf(normalize(file.content))])),
      },
    },
  };
};
