---
title: Deploy a service
description: Ship a container to the platform, from an empty project to a running service.
---

<script>
  import { Button, Stack } from "carbon-components-svelte";

  let deploys = 0;
</script>

## Before you start

You need a project and an API key. Keys look like `ak_live_…` and are passed as
the `Authorization` header. Config objects are written as `{ name, region }`,
and braces in prose stay literal: { name, region }.

- [x] Create a project
- [ ] Generate an API key
- [ ] Install the CLI

> [!NOTE]
> Keys are scoped to one project. Create one key per environment.

## Configure

Set these in `service.toml`. Values in **bold** are required.

| Setting | Default | Notes |
| :-- | :-: | --: |
| `name` | — | **Required** |
| `region` | `us-south` | Closest to most users |
| `replicas` | `2` | Scale with traffic |

### Environment variables

Read them from `process.env` at startup:

```js
export default {
  port: Number(process.env.PORT ?? 8080),
  env: { LOG_LEVEL: process.env.LOG_LEVEL ?? "info" },
};
```

> [!WARNING]
> Changing `region` recreates the service and drops in-flight requests.

## Deploy

Run the CLI, or use the buttons. A component block stays one block, even
with blank lines inside it:

```sh
acme deploy --project my-app
```

<Stack orientation="horizontal" gap={4}>
  <Button on:click={() => deploys++}>Deploy</Button>

  <Button kind="ghost" on:click={() => (deploys = 0)}>Reset</Button>
</Stack>

{#if deploys > 0}
<p>Deployed {deploys} {deploys === 1 ? "time" : "times"}.</p>
{/if}

## Clean up

1. Scale `replicas` to `0`.
2. Delete the service.
3. Revoke the API key.

> [!CAUTION]
> Deleting a service can't be undone.
