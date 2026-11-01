<script>
  import "carbon-components-svelte/css/all.css";
  import Guide from "./guide.md";

  // `?theme=g100` previews the dark theme.
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme) document.documentElement.setAttribute("theme", theme);
</script>

<Guide />
