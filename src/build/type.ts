import * as elements from "@carbon/elements";

type TypeStylesBreakpoint = Partial<
  Record<elements.BreakpointName, TypeStyles>
>;

interface TypeStyles
  extends Record<string, string | number | undefined | TypeStylesBreakpoint> {
  breakpoints?: TypeStylesBreakpoint;
}

export interface TypeStylesComputed {
  css: string;
  breakpoints: Array<any>;
}

export function serializeTypeStyles(type: TypeStyles): TypeStylesComputed {
  let fn: TypeStylesComputed = {
    css: "",
    breakpoints: [],
  };

  const entries = Object.entries(type);

  entries.forEach(([key, value], i) => {
    const property = elements.formatTokenName(key);

    if (key === "breakpoints") {
      fn.breakpoints = Object.entries(value as TypeStylesBreakpoint).map(
        ([breakpointName, value]) => {
          const mediaQuery = elements.breakpoint(
            breakpointName as elements.BreakpointName
          );

          return { mediaQuery, css: serializeTypeStyles(value!).css };
        }
      );
    } else {
      const semicolon = i === entries.length - 1 ? "" : ";";

      fn.css += `${property}: ${value}${semicolon}`;
    }
  });

  return fn;
}
