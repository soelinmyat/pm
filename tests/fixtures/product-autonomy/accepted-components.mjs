export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
export function shell(content) {
  return `<header class="app-header"><a href="#home" class="brand">FieldDesk</a><nav aria-label="Main"><a href="#home">Overview</a><a href="#work-orders">Work orders</a></nav><span class="demo">Isolated demo · simulated data</span></header><main>${content}</main>`;
}
export function list(jobs) {
  return `<div class="page-title"><div><p class="eyebrow">Operations</p><h1>Work orders</h1></div><span class="muted">Today</span></div><div class="jobs">${jobs.map((j) => `<a class="job-row" href="#work-order/${j.id}"><div><strong>${escape(j.title)}</strong><p>${escape(j.site)} · ${escape(j.assignee)}</p></div><span class="pill">In progress</span><span aria-hidden="true">›</span></a>`).join("")}</div>`;
}
export function gallery(items) {
  return `<div class="gallery" aria-label="Evidence photos">${items.map((_, i) => `<button class="photo" type="button" aria-label="Preview photo ${i + 1}" data-photo="${i}"><span aria-hidden="true">${["🪟", "🧹", "🧽", "🪣"][i % 4]}</span><small>Photo ${i + 1}</small></button>`).join("")}</div>`;
}
export function detail(job, progress) {
  return `<a class="back" href="#work-orders">← Work orders</a><div class="page-title"><div><p class="eyebrow">${escape(job.site)}</p><h1>${escape(job.title)}</h1></div><span class="pill">In progress</span></div><div class="detail-layout"><section><p class="description">${escape(job.description)}</p><h2>Work to complete</h2><p class="muted">${job.checkpoints.length} checkpoints · ${job.photos.length} evidence photos</p>${gallery(job.photos)}${progress ? `<div class="saved-progress"><h2>Saved progress</h2><p class="save-status">${progress.checks.filter(Boolean).length} of ${job.checkpoints.length} checkpoints · Saved in demo</p>${progress.note ? `<p>${escape(progress.note)}</p>` : ""}</div>` : ""}</section><aside><h2>Assigned to</h2><p>${escape(job.assignee)}</p><h2>Due</h2><p>Today, 4:00 PM</p><button class="primary" id="continue">Continue work</button></aside></div>`;
}
export function drawer(job, progress) {
  return `<dialog aria-labelledby="drawer-title" id="drawer"><form method="dialog"><div class="drawer-head"><div><p class="eyebrow">${escape(job.site)}</p><h2 id="drawer-title">${escape(job.title)}</h2></div><button aria-label="Close work order" value="close" class="close">×</button></div><div class="drawer-body"><p class="save-status" role="status" id="save-status">${progress ? `${progress.checks.filter(Boolean).length} of ${job.checkpoints.length} checkpoints saved in demo` : "Progress not saved yet"}</p><h3>Checkpoints</h3>${job.checkpoints.map((c, i) => `<label class="checkpoint"><input type="checkbox" data-check="${i}" ${progress?.checks[i] ? "checked" : ""}><span>${escape(c)}</span></label>`).join("")}<label class="note-label" for="note">Work notes</label><textarea id="note" rows="3" placeholder="Add a useful note for the next person">${escape(progress?.note || "")}</textarea><h3>Evidence</h3>${gallery(job.photos)}</div><div class="drawer-actions"><button type="button" id="save-progress" class="primary">Save progress</button><button type="button" id="complete">Complete work order</button></div></form></dialog>`;
}
