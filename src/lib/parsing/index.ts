import { ParserRegistry } from './registry';
import { csharpParser } from './languages/csharp';
import { goParser } from './languages/go';
import { javaParser } from './languages/java';
import { phpParser } from './languages/php';
import { pythonParser } from './languages/python';
import { rustParser } from './languages/rust';
import { javascriptParser, typescriptParser } from './languages/typescript';

/**
 * The default parser registry.
 *
 * Register new languages here — nothing else in the codebase needs to change.
 */
export const parsers = new ParserRegistry()
  .register(typescriptParser)
  .register(javascriptParser)
  .register(pythonParser)
  .register(javaParser)
  .register(goParser)
  .register(rustParser)
  .register(csharpParser)
  .register(phpParser);

export { ParserRegistry, type LanguageParser } from './registry';
export * from './scanner';
export * from './complexity';
