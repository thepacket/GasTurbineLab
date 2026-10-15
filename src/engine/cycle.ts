import { EngineInputs, EngineResult } from './types';
import { evaluate, designProvider } from './core';
import { validateEngineInputs } from './inputValidation';
export { propellerThrust } from './core';

/** Design-point solution. */
export function solveEngine(inp: EngineInputs): EngineResult {
  validateEngineInputs(inp);
  return evaluate(inp, designProvider(inp));
}
