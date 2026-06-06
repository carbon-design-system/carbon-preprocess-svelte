<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { TimePicker, TimePickerSelect } from "carbon-components-svelte";
</script>

<TimePicker labelText="Start time">
  <TimePickerSelect labelText="AM/PM">
    <option value="am">AM</option>
    <option value="pm">PM</option>
  </TimePickerSelect>
</TimePicker>
