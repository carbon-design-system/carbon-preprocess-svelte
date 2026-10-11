import type { Status } from "./api";

/** The `Tag` type for each user status. */
export const STATUS_TAG: Record<Status, "green" | "blue" | "red"> = {
  active: "green",
  invited: "blue",
  suspended: "red",
};

export const PAGE_SIZES = [10, 25, 50];

export const DEFAULT_PAGE_SIZE = 10;

export const TABLE_SIZE = "medium";

export const NAV = [
  { id: "overview", text: "Overview" },
  { id: "users", text: "Users" },
  { id: "settings", text: "Settings" },
] as const;

export type PageId = (typeof NAV)[number]["id"];
