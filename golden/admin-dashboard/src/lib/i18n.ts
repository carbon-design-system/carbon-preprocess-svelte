const MESSAGES: Record<string, string> = {
  "users.title": "Users",
  "users.description": "Everyone with access to this workspace.",
  "users.add": "Add user",
  "users.delete": "Delete user",
  "users.deleteConfirm": "This removes their access immediately.",
  "settings.title": "Settings",
  "settings.save": "Save changes",
  "settings.cancel": "Cancel",
  "overview.title": "Overview",
};

/** The message for `key`, or the key itself while it's untranslated. */
export const t = (key: string): string => MESSAGES[key] ?? key;
