<script lang="ts">
  import { Column, Grid, Row } from "carbon-components-svelte";
  import { t } from "./lib/i18n";
  import StatCard from "./StatCard.svelte";
</script>

<h1>{t("overview.title")}</h1>
<Grid>
  <Row>
    <Column
      sm={4}
      md={4}
      lg={4}
    >
      <StatCard
        label="Active users"
        value="1,204"
        trend="up"
      />
    </Column>
    <Column
      sm={4}
      md={4}
      lg={4}
    >
      <StatCard
        label="Pending invites"
        value="38"
      />
    </Column>
    <Column
      sm={4}
      md={4}
      lg={4}
    >
      <StatCard
        label="Suspended"
        value="5"
        trend="down"
      />
    </Column>
  </Row>
</Grid>
