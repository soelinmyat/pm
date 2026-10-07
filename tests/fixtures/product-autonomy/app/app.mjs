import { shell, list, detail, drawer } from "./ui/components.mjs";
const scenario = await fetch("/preview-data/jobs.json").then((r) => r.json());
const root = document.querySelector("#app");
function route() {
  const key = location.hash.slice(1) || "home";
  const job = scenario.jobs.find((j) => key === `work-order/${j.id}`);
  root.innerHTML = shell(
    job
      ? detail(job, null) + drawer(job)
      : key === "work-orders"
        ? list(scenario.jobs)
        : '<div class="page-title"><div><p class="eyebrow">Operations</p><h1>Overview</h1></div></div><p>Your team’s scheduled work is ready.</p><a href="#work-orders" class="primary inline">View work orders</a>'
  );
  if (job) {
    const dialog = root.querySelector("dialog");
    root.querySelector("#continue").onclick = () => dialog.showModal();
    root.querySelector("#complete").onclick = () => {
      dialog.close();
      location.hash = "work-orders";
    };
    root
      .querySelectorAll("[data-photo]")
      .forEach(
        (b) => (b.onclick = () => alert(b.getAttribute("aria-label") + " · simulated evidence"))
      );
  }
}
window.addEventListener("hashchange", route);
route();
