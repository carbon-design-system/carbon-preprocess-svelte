<h1>Heading 1</h1>
<h2>Heading 2</h2>
<div>Hello world</div>

<style>
  h1,
  h2 {
    font-family: "sans";
    font-weight: "semibold";
    background: "ui-01";
    color: "invalid color";
  }

  h2 {
    left: em(40px);
    right: px(40rem);
    top: rem();
    top: em();
    top: em(40);
    top: em(40px);
    top: px(40);
    background-color: rgba(#000, 1);
    background-color: rgba(#111111, -.2);
    background: rgba(#000000, 1);
    color: rgba(#ff0000, 0.4);
  }

  div {
    font: "expressive-heading-03";
    transition: background "easing.standard.productive";
    width: "container-05";
    right: -"spacing-05";
    padding-bottom: "spacing-07" * 4;
    margin-top: rem(-400px);
    margin-bottom: rem(0);
  }

  @media (between: 321px) and (md) {
    div {
      color: "blue-60";
    }
  }

  @media (up: lg) {
    div {
      color: transparent;
    }
  }

  @media (down: sm) {
    div {
      color: "interactive-02";
    }
  }
  
  @media (bp: xlg) {}
</style>
