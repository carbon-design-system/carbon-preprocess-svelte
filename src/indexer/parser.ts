import { createParser } from "sveast/core";
import { typescript } from "sveast/typescript";

/**
 * sveast without its HTML entity table: the indexer reads class names, which
 * never hold a named character reference, so `&copy;` staying as written
 * doesn't matter. TypeScript stays in, so a Carbon release that adds
 * `<script lang="ts">` still parses instead of throwing.
 */
export const { parse } = createParser({ typescript });
