<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { DatePicker, DatePickerInput } from "carbon-components-svelte";
</script>

<DatePicker datePickerType="single">
  <DatePickerInput
    labelText="Start date"
    placeholder="mm/dd/yyyy"
  />
</DatePicker>
