<script lang="ts">
  import {
    Button,
    ButtonSet,
    Form,
    FormGroup,
    Select,
    SelectItem,
    TextInput,
    Toggle,
  } from "carbon-components-svelte";
  import { t } from "./lib/i18n";
  import { notify, theme } from "./lib/stores";

  let workspace = $state("Acme");
  let emailDigest = $state(true);
  const nameError = $derived(
    workspace.trim() === "" ? "A workspace needs a name" : "",
  );
</script>

<h1>{t("settings.title")}</h1>
<Form
  on:submit={(event) => {
    event.preventDefault();
    notify("success", "Settings saved");
  }}
>
  <FormGroup legendText="Workspace">
    <TextInput
      labelText="Name"
      bind:value={workspace}
      invalid={nameError !== ""}
      invalidText={nameError}
    />
    <Select
      labelText="Theme"
      bind:selected={$theme}
    >
      <SelectItem
        value="white"
        text="White"
      />
      <SelectItem
        value="g10"
        text="Gray 10"
      />
      <SelectItem
        value="g90"
        text="Gray 90"
      />
      <SelectItem
        value="g100"
        text="Gray 100"
      />
    </Select>
  </FormGroup>
  <FormGroup legendText="Notifications">
    <Toggle
      labelText="Weekly email digest"
      bind:toggled={emailDigest}
    />
  </FormGroup>
  <ButtonSet>
    <Button kind="secondary">{t("settings.cancel")}</Button>
    <Button
      type="submit"
      disabled={nameError !== ""}
    >
      {t("settings.save")}
    </Button>
  </ButtonSet>
</Form>
