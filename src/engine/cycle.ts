import { EngineInputs, EngineResult } from './types';
import { evaluate, designProvider } from './core';
export { propellerThrust } from './core';

/** Design-point solution. */
export function solveEngine(inp: EngineInputs): EngineResult {
  return evaluate(inp, designProvider(inp));
}
