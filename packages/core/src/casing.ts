/**
 * One word-splitting rule for every identifier and label the generator derives
 * from a schema key. Labels, component names and hook names all start from the
 * same split, so `first_name` cannot become "First Name" in the UI and
 * `Firstname` in an identifier.
 */

export const capitalize = (word: string): string =>
  word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);

/** camelCase, acronym (`APIKey` → `API | Key`) and separator boundaries. */
export const splitWords = (name: string): readonly string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);

// Schema keys may start with a digit ("2fa"); identifiers may not. Prefixing
// here, once, beats remembering to do it at every emission site.
const identifierSafe = (name: string): string => (/^[0-9]/.test(name) ? `_${name}` : name);

export const pascalCase = (name: string): string =>
  identifierSafe(splitWords(name).map(capitalize).join(""));

export const camelCase = (name: string): string => {
  const pascal = splitWords(name).map(capitalize).join("");

  return identifierSafe(pascal.charAt(0).toLowerCase() + pascal.slice(1));
};

/** `firstName` / `first_name` / `APIKey` → "First Name" / "First Name" / "API Key". */
export const labelFromName = (name: string): string => splitWords(name).map(capitalize).join(" ");

/**
 * "Emergency Contacts" → "Emergency Contact", for the add-row button ("Add
 * emergency contact" reads as the action; the plural reads like a bulk import).
 *
 * Deliberately conservative: only the common English plurals reverse, and
 * anything unclassifiable passes through unchanged. A plural that survives is
 * lost polish; a mangled singular ("Statu") would be a bug in someone's UI.
 */
export const singularize = (label: string): string => {
  const words = label.split(" ");
  const last = words[words.length - 1] ?? "";
  const lower = last.toLowerCase();

  const singular =
    lower.length <= 3 || !lower.endsWith("s") || /(ss|us|is)$/.test(lower)
      ? last
      : lower.endsWith("ies")
        ? `${last.slice(0, -3)}y`
        : lower.endsWith("es") && /(s|x|z|ch|sh)$/.test(lower.slice(0, -2))
          ? last.slice(0, -2)
          : last.slice(0, -1);

  return [...words.slice(0, -1), singular].join(" ");
};

/** Whether `name` can be written bare as an object key or a member access. */
export const isIdentifier = (name: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
