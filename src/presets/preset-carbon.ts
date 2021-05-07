import { PreprocessorGroup } from "svelte/types/compiler/preprocess";
import { optimizeImports, elements, ElementsOptions } from "../preprocessors";

interface PresetOptions {
  elements: ElementsOptions;
}

export function presetCarbon(
  options?: Partial<PresetOptions>
): PreprocessorGroup[] {
  return [optimizeImports(), elements(options?.elements)];
}
