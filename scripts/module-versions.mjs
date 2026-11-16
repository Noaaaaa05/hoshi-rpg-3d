// The browser treats './combat.js?v=0.2.0' and './combat.js?v=0.2.7' as two modules.
// Both are downloaded and evaluated, so any module-level state would silently split.
const specifier = /(?:\bfrom|\bimport)\s*\(?\s*['"]\.\/([\w-]+\.js)(\?[^'"]*)?['"]/g;

export function conflictingImports(sources) {
  const modules = new Map();
  for (const [file, source] of Object.entries(sources)) {
    for (const [, name, query = ''] of source.matchAll(specifier)) {
      if (!modules.has(name)) modules.set(name, new Map());
      const importers = modules.get(name);
      importers.set(query, [...(importers.get(query) ?? []), file]);
    }
  }
  return [...modules].filter(([, importers]) => importers.size > 1).map(([name, importers]) =>
    name + ' is imported as ' + [...importers].map(([query, files]) =>
      "'./" + name + query + "' (" + files.join(', ') + ')').join(' and '));
}
