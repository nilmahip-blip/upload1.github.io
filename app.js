const $ = (s) => document.querySelector(s);
const fileInput = $("#fileInput");
const fileLabel = $("#fileLabel");
const form = $("#uploadForm");
const notice = $("#notice");
const uploadBtn = $("#uploadBtn");
const progressWrap = $("#progressWrap");
const progressBar = $("#progressBar");
const progressText = $("#progressText");
let maxFileSizeMB = 100;

function formatBytes(n) {
  if (!Number.isFinite(Number(n)) || Number(n) < 0) return "—";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت"];
  let value = Number(n), i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} ${units[i]}`;
}
function showNotice(message, kind = "success") {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
}
function hideNotice() { notice.hidden = true; }
function formatDate(value) {
  try { return new Date(value).toLocaleDateString("fa-IR"); } catch { return ""; }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
}
async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const s = await res.json();
    maxFileSizeMB = s.maxFileSizeMB || 100;
    $("#maxSize").textContent = maxFileSizeMB.toLocaleString("fa-IR");
    const badge = $("#connectionBadge");
    if (s.connected) { badge.textContent = "Google Drive متصل است"; badge.classList.add("connected"); $("#connectBtn").textContent = "اتصال مجدد"; }
    else { badge.textContent = "Google Drive متصل نیست"; badge.classList.remove("connected"); }
    if (new URLSearchParams(location.search).get("connected") === "1") {
      showNotice("اتصال Google Drive با موفقیت انجام شد.", "success");
      history.replaceState({}, "", "/");
    }
  } catch { $("#connectionBadge").textContent = "وضعیت اتصال نامشخص"; }
}
function renderFiles(files) {
  const list = $("#filesList");
  if (!files.length) {
    list.innerHTML = '<div class="empty">هنوز فایلی آپلود نشده است. پس از اتصال Google Drive می‌توانی اولین فایل را اضافه کنی.</div>';
    return;
  }
  list.innerHTML = files.map(f => {
    const name = escapeHtml(f.name || "بدون نام");
    const url = escapeHtml(f.directUrl || "#");
    const id = escapeHtml(f.id || "");
    return `<article class="file-card">
      <div class="file-icon">↧</div>
      <div class="file-info"><div class="file-name" title="${name}">${name}</div>
      <div class="file-meta"><span>${formatBytes(f.size)}</span><span>·</span><span>${formatDate(f.uploadedAt)}</span></div></div>
      <div class="file-actions">
        <a class="button button-download" href="${url}" target="_blank" rel="noopener noreferrer">دانلود مستقیم ↗</a>
        <button class="button button-copy" type="button" data-copy="${url}">کپی لینک</button>
        <button class="button button-copy" type="button" data-delete="${id}">حذف</button>
      </div></article>`;
  }).join("");
  list.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = "کپی شد ✓";
      setTimeout(() => btn.textContent = "کپی لینک", 1600);
    } catch { window.prompt("لینک دانلود را کپی کنید:", btn.dataset.copy); }
  }));
  list.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", async () => {
    const password = $("#adminPassword").value || window.prompt("رمز مدیریت را وارد کنید:");
    if (!password || !confirm("این فایل از Google Drive حذف شود؟")) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(btn.dataset.delete)}`, { method: "DELETE", headers: { "x-admin-password": password } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "حذف انجام نشد.");
      showNotice("فایل حذف شد.", "success");
      await loadFiles();
    } catch (e) { showNotice(e.message, "error"); btn.disabled = false; }
  }));
}
async function loadFiles() {
  const list = $("#filesList");
  list.innerHTML = '<div class="loading">در حال دریافت فهرست فایل‌ها…</div>';
  try {
    const res = await fetch("/api/files");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "خطا در دریافت فهرست.");
    renderFiles(data.files || []);
  } catch (e) { list.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileLabel.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "فایل را اینجا رها کن یا انتخاب کن";
  hideNotice();
});
const dropzone = $("#dropzone");
["dragenter", "dragover"].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.add("dragover"); }));
["dragleave", "drop"].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
dropzone.addEventListener("drop", e => {
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event("change"));
  }
});
form.addEventListener("submit", e => {
  e.preventDefault();
  hideNotice();
  const file = fileInput.files[0];
  const password = $("#adminPassword").value;
  if (!file) return showNotice("ابتدا یک فایل انتخاب کنید.", "error");
  if (file.size > maxFileSizeMB * 1024 * 1024) return showNotice(`حجم فایل باید کمتر از ${maxFileSizeMB} مگابایت باشد.`, "error");
  if (!password) return showNotice("رمز مدیریت را وارد کنید.", "error");
  const body = new FormData();
  body.append("file", file);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/upload");
  xhr.setRequestHeader("x-admin-password", password);
  uploadBtn.disabled = true;
  uploadBtn.textContent = "در حال آپلود…";
  progressWrap.hidden = false;
  progressBar.style.width = "0%";
  progressText.textContent = "۰٪";
  xhr.upload.onprogress = event => {
    if (!event.lengthComputable) return;
    const percent = Math.round(event.loaded / event.total * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent.toLocaleString("fa-IR")}٪`;
  };
  xhr.onload = async () => {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = 'آپلود به Google Drive <span>↗</span>';
    try {
      const data = JSON.parse(xhr.responseText || "{}");
      if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || "آپلود ناموفق بود.");
      showNotice("آپلود انجام شد. لینک دانلود مستقیم آماده است.", "success");
      form.reset();
      fileLabel.textContent = "فایل را اینجا رها کن یا انتخاب کن";
      await loadFiles();
    } catch (err) { showNotice(err.message, "error"); }
    setTimeout(() => { progressWrap.hidden = true; }, 1000);
  };
  xhr.onerror = () => {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = 'آپلود به Google Drive <span>↗</span>';
    showNotice("ارتباط با سرور قطع شد.", "error");
  };
  xhr.send(body);
});
$("#refreshBtn").addEventListener("click", loadFiles);
loadStatus();
loadFiles();
