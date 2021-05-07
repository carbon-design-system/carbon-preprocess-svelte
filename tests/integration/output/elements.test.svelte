<h1>Heading 1</h1>
<h2>Heading 2</h2>
<div>Hello world</div>

<style>
  h1,
  h2 {
    font-family: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
    font-weight: 600;
    background: #f4f4f4;
    color: "invalid color";
  }

  h2 {
    left: 2.5em;
    right: 40px;
    top: 0rem;
    top: 0em;
    top: 2.5em;
    top: 2.5em;
    top: 40px;
    background-color: rgba(#000, 1);
    background-color: rgba(17, 17, 1, 0);
    background: rgba(0, 0, 0, 1);
    color: rgba(240, 0, 0, 0.4);
  }

  div {
    font-size: 1.25rem;font-weight: 400;line-height: 1.4;letter-spacing: 0;;
    transition: background cubic-bezier(0.2, 0, 0.38, 0.9);
    width: 4rem;
    right: -1rem;
    padding-bottom: calc(2rem * 4);
    margin-top: -25rem;
    margin-bottom: 0rem;
  }

  @media (min-width: 321px) and (max-width: 42rem) {
    div {
      color: #0f62fe;
    }
  }

  @media (min-width: 66rem) {
    div {
      color: transparent;
    }
  }

  @media (max-width: 20rem) {
    div {
      color: #393939;
    }
  }
  
  @media (min-width: 82rem) {}

  @media (max-width: 42rem) {
    :global(.info-card:not(:nth-child(2))) {
      border-top: 1px solid #e0e0e0;
      padding-top: 3rem;
    }
  }

  @media (min-width: 42rem) {
    :global(.info-card:not(:nth-child(odd))) {
      border-left: 1px solid #e0e0e0;
    }
  }

  @media (min-width: 321px) and (max-width: 42rem) {
    p {
      max-width: 75%;
    }
  }
</style>
