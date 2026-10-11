<script>
  import {
    Checkbox,
    Dropdown,
    RadioButton,
    RadioButtonGroup,
  } from "carbon-components-svelte";
  import { COUNTRIES, PLANS } from "../config.js";
  import FormField from "../FormField.svelte";

  export let values;
</script>

<FormField
  label="Full name"
  bind:value={values.name}
/>
<FormField
  label="Company"
  helper="Leave blank if you're signing up for yourself"
  bind:value={values.company}
/>
<Dropdown
  labelText="Country"
  label="Choose a country"
  items={COUNTRIES}
  bind:selectedId={values.country}
/>
<RadioButtonGroup
  legendText="Plan"
  bind:selected={values.plan}
>
  {#each PLANS as plan}
    <RadioButton
      labelText={plan}
      value={plan}
    />
  {/each}
</RadioButtonGroup>
<Checkbox
  labelText="Send me product updates"
  bind:checked={values.updates}
/>
