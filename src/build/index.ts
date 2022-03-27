export * as type from "./type";

export interface BuildApi {
  metadata: {
    /**
     * Package name
     * @example "carbon-components-svelte"
     */
    package: string;

    /**
     * Package version
     * @example "0.32.0"
     */
    version: string;

    /**
     * Number of exports
     */
    exports: number;
  };
}
