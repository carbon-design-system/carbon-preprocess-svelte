<script>
  import { PasswordInput } from "carbon-components-svelte";
  import { FIELD_SIZE, MIN_PASSWORD_LENGTH } from "../config.js";
  import FormField from "../FormField.svelte";
  import { emailError, passwordError } from "../validate.js";

  export let values;

  $: emailMessage = emailError(values.email);
  $: passwordMessage = passwordError(values.password);
</script>

<FormField
  label="Work email"
  type="email"
  placeholder="you@company.com"
  error={emailMessage}
  bind:value={values.email}
/>
<PasswordInput
  size={FIELD_SIZE}
  labelText="Password"
  helperText="At least {MIN_PASSWORD_LENGTH} characters"
  invalid={passwordMessage !== ""}
  invalidText={passwordMessage}
  bind:value={values.password}
/>
