import { shell, list, detail, drawer } from "./ui/components.mjs";
const scenario = await fetch("/preview-data/jobs.json").then((r) => r.json());
const root = document.querySelector("#app");
function saved(id) {
  try {
    return JSON.parse(localStorage.getItem("pm-pilot-progress-" + id));
  } catch {
    return null;
  }
}
function route() {
  const key = location.hash.slice(1) || "home";
  const job = scenario.jobs.find((j) => key === `work-order/${j.id}`);
  const progress = job ? saved(job.id) : null;
  root.innerHTML = shell(
    job
      ? detail(job, progress) + drawer(job, progress)
      : key === "work-orders"
        ? list(scenario.jobs)
        : '<div class="page-title"><div><p class="eyebrow">Operations</p><h1>Overview</h1></div></div><p>Your team’s scheduled work is ready.</p><a href="#work-orders" class="primary inline">View work orders</a>'
  );
  if (job) {
    const dialog = root.querySelector("dialog");
    root.querySelector("#continue").onclick = () => dialog.showModal();
    root.querySelector("#save-progress").onclick = () => {
      const current = {
        note: root.querySelector("#note").value,
        checks: [...root.querySelectorAll("[data-check]")].map((c) => c.checked),
      };
      localStorage.setItem("pm-pilot-progress-" + job.id, JSON.stringify(current));
      root.querySelector("#save-status").textContent =
        `${current.checks.filter(Boolean).length} of ${job.checkpoints.length} checkpoints saved in demo`;
      root.querySelector("#save-progress").textContent = "Saved";
    };
    dialog.addEventListener("close", () => route());
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
