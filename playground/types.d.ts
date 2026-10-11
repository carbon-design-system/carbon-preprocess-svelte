// What the browser tests and scripts put on `window` in the page.
export {};

declare global {
  interface Window {
    /** Long tasks seen since load. */
    __long: number[];
    /** Layout shift values seen since load. */
    __shifts: number[];
    /** Event Timing entries over 16 ms (interact-bench). */
    __events: { name: string; duration: number }[];
    /** Contrast helpers (accessibility tests). */
    __rgb: (css: string) => number[];
    __ratio: (a: number[], b: number[]) => number;
    axe: {
      run: (
        context: unknown,
        options: unknown,
      ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
    };
  }
}
