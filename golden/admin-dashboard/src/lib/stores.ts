import { writable } from "svelte/store";

export type Toast = {
  id: number;
  kind: "success" | "error";
  title: string;
};

export const toasts = writable<Toast[]>([]);

let nextId = 0;

export function notify(kind: Toast["kind"], title: string) {
  const id = nextId++;
  toasts.update((all) => [...all, { id, kind, title }]);
  setTimeout(() => {
    toasts.update((all) => all.filter((toast) => toast.id !== id));
  }, 4000);
}

export const theme = writable<"white" | "g10" | "g90" | "g100">("white");
