"use strict";
const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
document.body.classList.add(mq.matches ? "dark" : "light");
mq.addEventListener("change", function (e) {
  document.body.classList.remove("light", "dark");
  document.body.classList.add(e.matches ? "dark" : "light");
});
