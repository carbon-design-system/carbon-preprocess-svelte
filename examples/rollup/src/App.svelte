<script>
// @ts-check
import "carbon-components-svelte/css/g100.css";
import { DataTable } from "carbon-components-svelte";

const tableProps = {
  sortable: true,
  selectable: true,
};
</script>
  
  <DataTable
    {...tableProps}
    headers={[
      { key: "name", value: "Name" },
      { key: "protocol", value: "Protocol" },
      { key: "port", value: "Port" },
      { key: "rule", value: "Rule" },
    ]}
    rows={[
      {
        id: "a",
        name: "Load Balancer 3",
        protocol: "HTTP",
        port: 3000,
        rule: "Round robin",
      },
      {
        id: "b",
        name: "Load Balancer 1",
        protocol: "HTTP",
        port: 443,
        rule: "Round robin",
      },
      {
        id: "c",
        name: "Load Balancer 2",
        protocol: "HTTP",
        port: 80,
        rule: "DNS delegation",
      },
      {
        id: "d",
        name: "Load Balancer 6",
        protocol: "HTTP",
        port: 3000,
        rule: "Round robin",
      },
      {
        id: "e",
        name: "Load Balancer 4",
        protocol: "HTTP",
        port: 443,
        rule: "Round robin",
      },
      {
        id: "f",
        name: "Load Balancer 5",
        protocol: "HTTP",
        port: 80,
        rule: "DNS delegation",
      },
    ]}
  />
  