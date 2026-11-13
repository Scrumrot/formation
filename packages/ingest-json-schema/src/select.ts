/**
 * Finding the one schema to generate from inside a document that may hold many.
 *
 * A bare JSON Schema *is* the schema. An OpenAPI document is a container: its
 * schemas live under `components.schemas`, and "the form" could be any of them
 * or a request body buried in `paths`. Selection is kept apart from the walk so
 * the walk never has to know which kind of document it was handed.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Own-key lookup, so a schema named `constructor` reports "not found" instead of finding a prototype member. */
export const own = (record: JsonRecord, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

// JSON Pointer (RFC 6901) inside a URI fragment: percent-decoding comes first,
// then `~1` → `/`, then `~0` → `~`. The order matters — `~01` must come out as
// `~1`, not `/`.
const decodeSegment = (segment: string): string => {
  const unescape = (value: string): string => value.replace(/~1/g, "/").replace(/~0/g, "~");

  try {
    return unescape(decodeURIComponent(segment));
  } catch {
    // A stray `%` is not valid percent-encoding. Treat it as literal text
    // rather than failing the whole lookup over one malformed segment.
    return unescape(segment);
  }
};

export const pointerSegments = (pointer: string): readonly string[] =>
  pointer
    .replace(/^#\/?/, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeSegment);

/** Resolves a local `#/…` pointer, or `undefined` when any step is missing. */
export const resolvePointer = (root: unknown, pointer: string): unknown =>
  pointerSegments(pointer).reduce<unknown>(
    (node, segment) =>
      Array.isArray(node)
        ? /^\d+$/.test(segment)
          ? (node as readonly unknown[])[Number(segment)]
          : undefined
        : isRecord(node)
          ? own(node, segment)
          : undefined,
    root,
  );

// Where named schemas live, in lookup order: OpenAPI 3, JSON Schema 2019-09+,
// then draft-07 and Swagger 2.
const NAME_STORES: readonly (readonly string[])[] = [
  ["components", "schemas"],
  ["$defs"],
  ["definitions"],
];

const storeAt = (root: unknown, segments: readonly string[]): JsonRecord | undefined => {
  const node = segments.reduce<unknown>(
    (current, segment) => (isRecord(current) ? own(current, segment) : undefined),
    root,
  );

  return isRecord(node) ? node : undefined;
};

const namedSchemas = (root: unknown): readonly (readonly [string, unknown])[] =>
  NAME_STORES.flatMap((segments) => Object.entries(storeAt(root, segments) ?? {}));

const SCHEMA_KEYWORDS: readonly string[] = [
  "type",
  "properties",
  "$ref",
  "allOf",
  "oneOf",
  "anyOf",
  "enum",
  "items",
];

/**
 * A container document describes an API and is not itself a schema. The
 * `openapi`/`swagger` marker settles it; failing that, a document carrying no
 * schema keyword of its own but holding named schemas is a container too (a
 * bare `{ "$defs": { … } }` file).
 */
const isContainer = (document: JsonRecord): boolean =>
  own(document, "openapi") !== undefined ||
  own(document, "swagger") !== undefined ||
  !SCHEMA_KEYWORDS.some((keyword) => own(document, keyword) !== undefined);

export type Selection =
  | Readonly<{ kind: "found"; schema: unknown; name: string | undefined }>
  | Readonly<{ kind: "missing"; message: string }>;

const listed = (names: readonly string[]): string =>
  names.length === 0 ? "none" : names.map((name) => `"${name}"`).join(", ");

export const selectSchema = (document: unknown, select: string | undefined): Selection => {
  if (!isRecord(document)) {
    return { kind: "missing", message: "The document is not a JSON object." };
  }

  const named = namedSchemas(document);
  const names = named.map(([name]) => name);

  if (select !== undefined && select.startsWith("#")) {
    const schema = resolvePointer(document, select);
    const segments = pointerSegments(select);

    return schema === undefined
      ? { kind: "missing", message: `Nothing at pointer "${select}".` }
      : { kind: "found", schema, name: segments[segments.length - 1] };
  }

  if (select !== undefined) {
    const match = named.find(([name]) => name === select);

    return match === undefined
      ? {
          kind: "missing",
          message: `No schema named "${select}". Available: ${listed(names)}. Use a "#/…" pointer to reach anything else.`,
        }
      : { kind: "found", schema: match[1], name: select };
  }

  if (!isContainer(document)) {
    const title = own(document, "title");

    return { kind: "found", schema: document, name: typeof title === "string" ? title : undefined };
  }

  const only = named[0];

  // Guessing among several schemas would generate the wrong form with total
  // confidence, so more than one is an error that lists the choices.
  return named.length === 1 && only !== undefined
    ? { kind: "found", schema: only[1], name: only[0] }
    : {
        kind: "missing",
        message:
          named.length === 0
            ? 'The document holds no named schemas. Point at one with a "#/…" pointer.'
            : `The document holds ${named.length} schemas; pick one with --select. Available: ${listed(names)}.`,
      };
};
