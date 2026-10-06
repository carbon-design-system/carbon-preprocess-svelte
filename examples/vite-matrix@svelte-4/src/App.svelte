<script>
  import "carbon-components-svelte/css/white.css";
  import {
    Accordion,
    AccordionItem,
    Button,
    Checkbox,
    Column,
    ComboBox,
    Content,
    DataTable,
    Dropdown,
    Grid,
    Header,
    HeaderNav,
    HeaderNavItem,
    InlineNotification,
    Link,
    Modal,
    MultiSelect,
    NumberInput,
    Pagination,
    PasswordInput,
    ProgressIndicator,
    ProgressStep,
    RadioButton,
    RadioButtonGroup,
    Row,
    Select,
    SelectItem,
    SkipToContent,
    Slider,
    Tab,
    TabContent,
    Tabs,
    Tag,
    TextInput,
    Tile,
    Toggle,
    Toolbar,
    ToolbarContent,
    ToolbarSearch,
    TooltipDefinition,
  } from "carbon-components-svelte";
  import ActionButton from "./ActionButton.svelte";

  const regions = [
    { id: "us-east", text: "US East" },
    { id: "us-west", text: "US West" },
    { id: "eu-de", text: "EU Germany" },
  ];

  const headers = [
    { key: "name", value: "Name" },
    { key: "protocol", value: "Protocol" },
    { key: "port", value: "Port" },
    { key: "rule", value: "Rule" },
  ];

  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: String(i),
    name: `Load Balancer ${i + 1}`,
    protocol: i % 3 === 0 ? "HTTPS" : "HTTP",
    port: [80, 443, 3000][i % 3],
    rule: i % 2 === 0 ? "Round robin" : "DNS delegation",
  }));

  let open = false;
  let page = 1;
  let pageSize = 5;
  let filteredRowIds = [];
  let region = "us-east";
  let saved = false;
</script>

<Header
  company="IBM"
  platformName="Carbon Svelte"
>
  <svelte:fragment slot="skip-to-content">
    <SkipToContent />
  </svelte:fragment>
  <HeaderNav>
    <HeaderNavItem
      href="/"
      text="Overview"
    />
    <HeaderNavItem
      href="/"
      text="Settings"
    />
  </HeaderNav>
</Header>

<Content>
  <Grid>
    <!-- Simple: a few components, mostly literal props. -->
    <Row>
      <Column>
        <h1>Load balancers</h1>
        <p>
          Configure the
          <TooltipDefinition
            tooltipText="A rule decides which server takes a request."
          >
            routing rules
          </TooltipDefinition>
          for each region. <Link href="/">Learn more</Link>
        </p>
        <Tag type="blue">Beta</Tag>
        <Tag type="green">Healthy</Tag>
      </Column>
    </Row>

    {#if saved}
      <Row>
        <Column>
          <InlineNotification
            kind="success"
            lowContrast
            title="Saved"
            subtitle="Your settings were saved."
          />
        </Column>
      </Row>
    {/if}

    <!-- Medium: forms and list boxes, some props bound to state. -->
    <Row>
      <Column
        sm={4}
        md={4}
        lg={8}
      >
        <Tile>
          <TextInput
            labelText="Name"
            placeholder="my-load-balancer"
          />
          <PasswordInput
            labelText="API key"
            placeholder="Enter an API key"
          />
          <NumberInput
            label="Instances"
            value={3}
            min={1}
            max={10}
          />
          <Select
            labelText="Protocol"
            selected="https"
          >
            <SelectItem
              value="http"
              text="HTTP"
            />
            <SelectItem
              value="https"
              text="HTTPS"
            />
          </Select>
          <Slider
            labelText="Timeout (seconds)"
            min={5}
            max={60}
            value={30}
          />
          <Checkbox labelText="Enable health checks" />
          <Toggle labelText="Sticky sessions" />
          <RadioButtonGroup
            legendText="Algorithm"
            selected="round-robin"
          >
            <RadioButton
              labelText="Round robin"
              value="round-robin"
            />
            <RadioButton
              labelText="Least connections"
              value="least-connections"
            />
          </RadioButtonGroup>
        </Tile>
      </Column>
      <Column
        sm={4}
        md={4}
        lg={8}
      >
        <Tile>
          <Dropdown
            titleText="Region"
            items={regions}
            bind:selectedId={region}
          />
          <ComboBox
            titleText="Fallback region"
            placeholder="Select a region"
            items={regions}
          />
          <MultiSelect
            titleText="Availability zones"
            label="Select zones"
            items={regions}
          />
          <ProgressIndicator currentIndex={1}>
            <ProgressStep
              label="Create"
              complete
            />
            <ProgressStep label="Configure" />
            <ProgressStep label="Deploy" />
          </ProgressIndicator>
        </Tile>
      </Column>
    </Row>

    <!-- Complex: tabs, accordion, a data table with toolbar and pagination,
         and a modal. -->
    <Row>
      <Column>
        <Tabs>
          <Tab label="Balancers" />
          <Tab label="Details" />
          <svelte:fragment slot="content">
            <TabContent>
              <DataTable
                sortable
                title="Load balancers"
                description="Every balancer in this region."
                {headers}
                {rows}
                {pageSize}
                {page}
              >
                <Toolbar>
                  <ToolbarContent>
                    <ToolbarSearch
                      persistent
                      shouldFilterRows
                      bind:filteredRowIds
                    />
                    <Button on:click={() => (open = true)}>Add balancer</Button>
                  </ToolbarContent>
                </Toolbar>
              </DataTable>
              <Pagination
                bind:pageSize
                bind:page
                totalItems={filteredRowIds.length}
                pageSizeInputDisabled
              />
            </TabContent>
            <TabContent>
              <Accordion>
                <AccordionItem title="Health checks">
                  <p>Requests every 10 seconds to <code>/health</code>.</p>
                </AccordionItem>
                <AccordionItem title="Certificates">
                  <p>Managed certificates renew automatically.</p>
                </AccordionItem>
              </Accordion>
            </TabContent>
          </svelte:fragment>
        </Tabs>
      </Column>
    </Row>

    <Row>
      <Column>
        <ActionButton
          primary
          on:click={() => (saved = true)}
        >
          Save settings
        </ActionButton>
        <ActionButton>Cancel</ActionButton>
      </Column>
    </Row>
  </Grid>
</Content>

<Modal
  bind:open
  modalHeading="Add a load balancer"
  primaryButtonText="Add"
  secondaryButtonText="Cancel"
  on:click:button--secondary={() => (open = false)}
  on:submit={() => (open = false)}
>
  <TextInput labelText="Name" />
</Modal>
