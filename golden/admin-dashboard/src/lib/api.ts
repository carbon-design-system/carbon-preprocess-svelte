export type Status = "active" | "invited" | "suspended";

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: Status;
};

const USERS: User[] = [
  {
    id: "u1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "Admin",
    status: "active",
  },
  {
    id: "u2",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "Editor",
    status: "invited",
  },
  {
    id: "u3",
    name: "Alan Turing",
    email: "alan@example.com",
    role: "Viewer",
    status: "suspended",
  },
];

/** Stands in for `fetch("/api/users")`. */
export async function fetchUsers(): Promise<User[]> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return USERS.map((user) => ({ ...user }));
}

export async function deleteUser(id: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  const index = USERS.findIndex((user) => user.id === id);
  if (index !== -1) USERS.splice(index, 1);
}
