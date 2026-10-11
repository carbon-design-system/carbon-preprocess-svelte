/**
 * Interaction scripts for the golden apps (`golden/`), run by
 * `eval-interactions.ts` on every build variant. Each walks the app into
 * the states its first render never shows: fetched data, opened menus and
 * modals, validation errors, later wizard steps, toasts.
 */
import type { Page } from "playwright";

const THEMING = /Theming/;
const CART = /^Cart/;

export type Step = { name: string; run: (page: Page) => Promise<unknown> };

export type GoldenScenario = {
  /** An element present once the app has rendered. */
  ready: string;
  steps: Step[];
};

export const GOLDEN_SCENARIOS: Record<string, GoldenScenario> = {
  "admin-dashboard": {
    ready: ".bx--header",
    steps: [
      { name: "load", run: async () => {} },
      {
        name: "open users",
        run: async (page) => {
          await page.getByRole("link", { name: "Users" }).click();
          await page.waitForSelector(".bx--data-table");
        },
      },
      {
        name: "search users",
        run: (page) => page.getByRole("searchbox").first().fill("grace"),
      },
      {
        name: "clear search",
        run: (page) => page.getByRole("searchbox").first().fill(""),
      },
      {
        name: "open row menu",
        run: (page) => page.locator(".bx--overflow-menu").first().click(),
      },
      {
        name: "ask to delete",
        run: (page) =>
          page.getByRole("menuitem", { name: "Delete user" }).click(),
      },
      {
        name: "cancel delete",
        run: (page) => page.getByRole("button", { name: "Cancel" }).click(),
      },
      {
        name: "open settings",
        run: (page) => page.getByRole("link", { name: "Settings" }).click(),
      },
      {
        name: "clear the workspace name",
        run: (page) => page.getByLabel("Name").fill(""),
      },
      {
        name: "turn off the digest",
        run: (page) => page.getByText("Weekly email digest").click(),
      },
    ],
  },
  "signup-wizard": {
    ready: ".bx--progress",
    steps: [
      { name: "load", run: async () => {} },
      {
        name: "type an invalid email",
        run: (page) => page.getByLabel("Work email").fill("nope"),
      },
      {
        name: "fill in the account",
        run: async (page) => {
          await page.getByLabel("Work email").fill("ada@example.com");
          await page.getByLabel("Password").fill("correct horse battery");
        },
      },
      {
        name: "continue to the profile",
        run: (page) => page.getByRole("button", { name: "Continue" }).click(),
      },
      {
        name: "open the country list",
        run: (page) => page.locator(".bx--list-box__field").first().click(),
      },
      {
        name: "pick a country",
        run: (page) => page.getByRole("option", { name: "Canada" }).click(),
      },
      {
        name: "pick a plan",
        run: (page) => page.getByText("team", { exact: true }).click(),
      },
      {
        name: "continue to the review",
        run: (page) => page.getByRole("button", { name: "Continue" }).click(),
      },
      {
        name: "create the account",
        run: async (page) => {
          await page.getByRole("button", { name: "Create account" }).click();
          await page.waitForSelector(".bx--toast-notification");
        },
      },
    ],
  },
  "docs-site": {
    ready: ".bx--header",
    steps: [
      { name: "load", run: async () => {} },
      {
        name: "switch package manager",
        run: (page) => page.getByRole("tab", { name: "pnpm" }).click(),
      },
      {
        name: "expand a question",
        run: (page) =>
          page
            .getByRole("button", { name: "Does it support Svelte 5?" })
            .click(),
      },
      {
        name: "open the resources menu",
        run: (page) => page.getByText("Resources").click(),
      },
      {
        name: "hover a guide",
        run: (page) => page.getByRole("link", { name: THEMING }).hover(),
      },
    ],
  },
  "product-catalog": {
    ready: ".bx--grid",
    steps: [
      {
        name: "load products",
        run: (page) => page.waitForSelector("text=Studio headphones"),
      },
      {
        name: "search",
        run: (page) => page.getByPlaceholder("Search products").fill("phone"),
      },
      {
        name: "clear the search",
        run: (page) => page.getByPlaceholder("Search products").fill(""),
      },
      {
        name: "open categories",
        run: (page) =>
          page.locator(".bx--multi-select .bx--list-box__field").click(),
      },
      {
        name: "pick a category",
        run: async (page) => {
          await page.getByRole("option", { name: "Audio" }).click();
          await page.keyboard.press("Escape");
        },
      },
      {
        name: "add to cart",
        run: async (page) => {
          await page
            .getByRole("button", { name: "Add to cart" })
            .first()
            .click();
          await page.waitForSelector(".bx--toast-notification");
        },
      },
      {
        name: "open the cart",
        run: (page) => page.getByRole("button", { name: CART }).click(),
      },
    ],
  },
};
