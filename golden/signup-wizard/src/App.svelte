<script>
  import {
    Button,
    Column,
    Grid,
    InlineLoading,
    ProgressIndicator,
    ProgressStep,
    Row,
    ToastNotification,
  } from "carbon-components-svelte";
  import { STEPS } from "./config.js";
  import Account from "./steps/Account.svelte";
  import Profile from "./steps/Profile.svelte";
  import Review from "./steps/Review.svelte";
  import { emailError, passwordError } from "./validate.js";

  let current = 0;
  let submitting = false;
  let submitted = false;
  let values = {
    email: "",
    password: "",
    name: "",
    company: "",
    country: undefined,
    plan: "free",
    updates: true,
  };

  $: isLast = current === STEPS.length - 1;
  $: canContinue =
    current !== 0 ||
    (values.email !== "" &&
      emailError(values.email) === "" &&
      passwordError(values.password) === "" &&
      values.password !== "");

  async function next() {
    if (!isLast) {
      current += 1;
      return;
    }
    submitting = true;
    await new Promise((resolve) => setTimeout(resolve, 500));
    submitting = false;
    submitted = true;
  }
</script>

<Grid>
  <Row>
    <Column>
      <h1>Create your account</h1>
      <ProgressIndicator
        currentIndex={current}
        spaceEqually
      >
        {#each STEPS as step, index (step.id)}
          <ProgressStep
            label={step.label}
            description={step.description}
            complete={index < current}
            current={index === current}
          />
        {/each}
      </ProgressIndicator>
    </Column>
  </Row>
  <Row>
    <Column lg={8}>
      {#if current === 0}
        <Account bind:values />
      {:else if current === 1}
        <Profile bind:values />
      {:else}
        <Review {values} />
      {/if}
    </Column>
  </Row>
  <Row>
    <Column>
      <Button
        kind="secondary"
        disabled={current === 0 || submitting}
        on:click={() => (current -= 1)}
      >
        Back
      </Button>
      {#if submitting}
        <InlineLoading description="Creating your account…" />
      {:else}
        <Button
          kind={isLast ? "primary" : "tertiary"}
          disabled={!canContinue}
          on:click={next}
        >
          {isLast ? "Create account" : "Continue"}
        </Button>
      {/if}
    </Column>
  </Row>
</Grid>

{#if submitted}
  <ToastNotification
    kind="success"
    title="Account created"
    subtitle="Check your inbox to confirm your email."
  />
{/if}
