<script>
  import {
    Accordion,
    AccordionItem,
    Breadcrumb,
    BreadcrumbItem,
    CodeSnippet,
    Column,
    Content,
    Grid,
    Header,
    HeaderNav,
    HeaderNavItem,
    HeaderNavMenu,
    Link,
    ListItem,
    Row,
    Tab,
    TabContent,
    Tabs,
    UnorderedList,
  } from "carbon-components-svelte";
  import Callout from "./Callout.svelte";
  import { FAQ, GUIDES, INSTALL, NAV } from "./content.js";
  import GuideCard from "./GuideCard.svelte";

  const managers = Object.keys(INSTALL);
  let selected = 0;
</script>

<Header
  platformName="Carbon Svelte"
  href="/"
>
  <HeaderNav>
    {#each NAV as item}
      <HeaderNavItem
        href={item.href}
        text={item.text}
      />
    {/each}
    <HeaderNavMenu text="Resources">
      <HeaderNavItem
        href="#changelog"
        text="Changelog"
      />
      <HeaderNavItem
        href="#github"
        text="GitHub"
      />
    </HeaderNavMenu>
  </HeaderNav>
</Header>

<Content>
  <Grid>
    <Row>
      <Column>
        <Breadcrumb noTrailingSlash>
          <BreadcrumbItem href="/">Docs</BreadcrumbItem>
          <BreadcrumbItem
            href="#start"
            isCurrentPage
            >Get started</BreadcrumbItem
          >
        </Breadcrumb>
        <h1 id="start">Get started</h1>
        <p>
          Carbon Svelte implements the
          <Link
            href="https://carbondesignsystem.com"
            inline
            >Carbon Design System</Link
          >
          in Svelte.
        </p>
      </Column>
    </Row>

    <Row>
      <Column>
        <h2 id="install">Install</h2>
        <Tabs bind:selected>
          {#each managers as manager}
            <Tab label={manager} />
          {/each}
          <svelte:fragment slot="content">
            {#each managers as manager}
              <TabContent>
                <CodeSnippet code={INSTALL[manager]} />
              </TabContent>
            {/each}
          </svelte:fragment>
        </Tabs>
        <Callout title="Styles">
          Import a theme stylesheet once, at your app's entry point.
        </Callout>
        <CodeSnippet
          type="multi"
          code={`import "carbon-components-svelte/css/white.css";\nimport App from "./App.svelte";`}
        />
      </Column>
    </Row>

    <Row>
      <Column>
        <h2 id="guides">Guides</h2>
      </Column>
    </Row>
    <Row>
      {#each GUIDES as guide, index}
        <Column
          sm={4}
          md={4}
          lg={5}
        >
          <GuideCard
            title={guide.title}
            href={guide.href}
            summary={guide.summary}
            featured={index === 0}
          />
        </Column>
      {/each}
    </Row>

    <Row>
      <Column>
        <h2>Frequently asked</h2>
        <Accordion>
          {#each FAQ as item}
            <AccordionItem title={item.question}>
              <p>{item.answer}</p>
            </AccordionItem>
          {/each}
        </Accordion>
        <Callout
          kind="warning"
          title="Svelte 3"
        >
          Svelte 3 support ends with the next major release.
        </Callout>
        <UnorderedList>
          <ListItem><Link href="#changelog">Changelog</Link></ListItem>
          <ListItem><Link href="#github">Source on GitHub</Link></ListItem>
        </UnorderedList>
      </Column>
    </Row>
  </Grid>
</Content>
