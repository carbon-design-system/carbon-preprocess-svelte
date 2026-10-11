import "carbon-components-svelte/css/white.css";
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app") as HTMLElement });
