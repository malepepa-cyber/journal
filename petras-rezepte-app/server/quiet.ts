// Muss als ERSTES geladen werden: unterdrückt den Hinweis „SQLite is experimental“.
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  if (String((warning as Error)?.message ?? warning).includes('SQLite')) return;
  return (original as (...a: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;
export {};
