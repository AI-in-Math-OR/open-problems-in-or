/**
 * Upload page: login + PDF intake + extract jobs.
 *
 * Talks to SITE_CONFIG.uploadApiBaseUrl:
 *   POST {base}/auth/login
 *   POST/GET {base}/api/uploads
 *   GET  {base}/api/uploads/{id}/file
 *   POST {base}/api/uploads/{id}/jobs  {kind:"extract"}
 */
(function () {
  "use strict";

  const SESSION_KEY = "opor_upload_session_v1";
  const config = window.SITE_CONFIG || {};
  const apiBase = String(config.uploadApiBaseUrl || "").replace(/\/$/, "");
  let pollTimer = null;

  const els = {
    banner: document.getElementById("upload-status-banner"),
    loginPanel: document.getElementById("login-panel"),
    uploadPanel: document.getElementById("upload-panel"),
    loginForm: document.getElementById("login-form"),
    loginError: document.getElementById("login-error"),
    loginSubmit: document.getElementById("login-submit"),
    sessionLabel: document.getElementById("session-label"),
    logoutBtn: document.getElementById("logout-btn"),
    dropzone: document.getElementById("upload-dropzone"),
    fileInput: document.getElementById("upload-file-input"),
    uploadError: document.getElementById("upload-error"),
    uploadList: document.getElementById("upload-list"),
    uploadEmpty: document.getElementById("upload-empty"),
    resultsList: document.getElementById("results-list"),
    resultsEmpty: document.getElementById("results-empty"),
  };

  function isSourceKind(kind) {
    return !kind || kind === "source";
  }

  function kindLabel(kind) {
    if (kind === "extraction") return "extraction";
    if (kind === "literature_review") return "literature review";
    if (kind === "solver_attempt" || kind === "solve_report") return "solver attempt";
    return kind || "output";
  }

  function apiConfigured() {
    return Boolean(apiBase);
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  }

  function saveSession(session) {
    if (!session) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function setBanner(text, state) {
    if (!els.banner) return;
    els.banner.textContent = text;
    els.banner.classList.toggle("is-connected", state === "connected");
    els.banner.classList.toggle("is-scaffold", state === "scaffold");
  }

  function setError(node, message) {
    if (node) node.textContent = message || "";
  }

  function authHeaders(session) {
    const headers = { Accept: "application/json" };
    if (session && session.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }
    return headers;
  }

  async function apiFetch(path, options = {}, session) {
    if (!apiConfigured()) {
      const err = new Error(
        "Upload backend is not configured yet (SITE_CONFIG.uploadApiBaseUrl is empty)."
      );
      err.code = "SCAFFOLD";
      throw err;
    }
    const opts = { ...options, credentials: "include" };
    opts.headers = { ...authHeaders(session), ...(options.headers || {}) };
    const res = await fetch(`${apiBase}${path}`, opts);
    let body = null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    if (!res.ok) {
      const detail =
        (body && body.detail) ||
        (body && body.message) ||
        (typeof body === "string" ? body : "") ||
        res.statusText;
      const err = new Error(detail || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function renderSession(session) {
    const signedIn = Boolean(session && session.username);
    els.loginPanel.hidden = signedIn;
    els.uploadPanel.hidden = !signedIn;
    if (signedIn) {
      els.sessionLabel.textContent = `Signed in as ${session.username}`;
    }
    setError(els.loginError, "");
    setError(els.uploadError, "");
  }

  function formatUploadDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString(undefined, { dateStyle: "medium" });
  }

  function statusPill(status) {
    const pill = document.createElement("span");
    pill.className = "upload-status-pill";
    const key = String(status || "").toLowerCase();
    if (key === "extracted" || key === "done" || key.startsWith("review")) {
      pill.classList.add("is-reviewed");
    } else if (
      key === "queued" ||
      key === "running" ||
      key.startsWith("pending") ||
      key.startsWith("process")
    ) {
      pill.classList.add("is-pending");
    }
    pill.textContent = status;
    return pill;
  }

  function latestJob(item) {
    const jobs = Array.isArray(item.jobs) ? item.jobs : [];
    return jobs.length ? jobs[0] : null;
  }

  function hasActiveJob(items) {
    return (items || []).some((item) => {
      const job = latestJob(item);
      return job && (job.status === "queued" || job.status === "running");
    });
  }

  function downloadHref(uploadId) {
    return `${apiBase}/api/uploads/${uploadId}/file`;
  }

  async function downloadUpload(uploadId, session) {
    const res = await fetch(downloadHref(uploadId), {
      headers: authHeaders(session),
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upload-${uploadId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function startExtract(uploadId, session, button) {
    setError(els.uploadError, "");
    if (button) button.disabled = true;
    try {
      await apiFetch(
        `/api/uploads/${uploadId}/jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "extract" }),
        },
        session
      );
      await refreshUploads(session);
    } catch (err) {
      setError(els.uploadError, err.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderList(targetList, emptyNode, items, session, mode, parentNames) {
    if (!targetList || !emptyNode) return;
    targetList.innerHTML = "";
    if (!items.length) {
      emptyNode.hidden = false;
      targetList.hidden = true;
      return;
    }
    emptyNode.hidden = true;
    targetList.hidden = false;

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "upload-list-item";

      const kind = item.kind || "source";
      const name = document.createElement("span");
      const label = item.filename || item.name || "upload.pdf";
      if (mode === "results") {
        name.textContent = `${label} (${kindLabel(kind)})`;
      } else {
        name.textContent = label;
      }

      const meta = document.createElement("span");
      meta.className = "upload-list-meta";
      const job = latestJob(item);
      const bits = [formatUploadDate(item.uploaded_at || item.created_at || "")];
      if (mode === "results" && item.parent_upload_id) {
        const parentName = parentNames && parentNames[item.parent_upload_id];
        bits.push(parentName ? `from ${parentName}` : `from upload #${item.parent_upload_id}`);
      }
      if (mode === "sources" && job) {
        bits.push(`extract: ${job.status}`);
        if (job.error_message) bits.push(String(job.error_message).slice(0, 80));
      }
      meta.textContent = bits.filter(Boolean).join(" · ");

      let status = String(item.status || "received").trim() || "received";
      if (mode === "sources" && job) status = job.status;

      li.appendChild(name);
      li.appendChild(meta);
      li.appendChild(statusPill(status));

      const actions = document.createElement("div");
      actions.className = "upload-list-actions";

      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "upload-btn upload-btn-secondary";
      dl.textContent = "Download";
      dl.addEventListener("click", async () => {
        try {
          await downloadUpload(item.id, session);
        } catch (err) {
          setError(els.uploadError, err.message);
        }
      });
      actions.appendChild(dl);

      if (mode === "sources") {
        const extractBtn = document.createElement("button");
        extractBtn.type = "button";
        extractBtn.className = "upload-btn";
        const active = job && (job.status === "queued" || job.status === "running");
        extractBtn.textContent = active ? "Extracting…" : "Extract";
        extractBtn.disabled = Boolean(active);
        extractBtn.addEventListener("click", () => startExtract(item.id, session, extractBtn));
        actions.appendChild(extractBtn);
      }

      li.appendChild(actions);
      targetList.appendChild(li);
    }
  }

  function renderUploads(items, session) {
    const list = Array.isArray(items) ? items : [];
    const sources = list.filter((item) => isSourceKind(item.kind));
    const results = list.filter((item) => !isSourceKind(item.kind));
    const parentNames = Object.create(null);
    for (const src of sources) {
      parentNames[src.id] = src.filename || src.name || `upload #${src.id}`;
    }

    renderList(els.uploadList, els.uploadEmpty, sources, session, "sources", parentNames);
    renderList(els.resultsList, els.resultsEmpty, results, session, "results", parentNames);

    if (hasActiveJob(sources)) {
      startPolling(session);
    } else {
      stopPolling();
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling(session) {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      refreshUploads(session, true);
    }, 5000);
  }

  async function refreshUploads(session, quiet) {
    if (!apiConfigured()) {
      renderUploads([], session);
      return;
    }
    try {
      const data = await apiFetch("/api/uploads", { method: "GET" }, session);
      renderUploads(data.items || data.uploads || data || [], session);
      if (!quiet) setError(els.uploadError, "");
    } catch (err) {
      if (err.status === 401) {
        saveSession(null);
        renderSession(null);
        stopPolling();
      }
      if (!quiet) setError(els.uploadError, err.message);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setError(els.loginError, "");
    const username = String(els.loginForm.username.value || "").trim();
    const password = String(els.loginForm.password.value || "");
    if (!username || !password) {
      setError(els.loginError, "Enter a username and password.");
      return;
    }

    els.loginSubmit.disabled = true;
    try {
      const data = await apiFetch(
        "/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
        null
      );
      const session = {
        username: (data.user && data.user.username) || data.username || username,
        token: data.token || data.access_token || null,
      };
      saveSession(session);
      renderSession(session);
      els.loginForm.reset();
      await refreshUploads(session);
    } catch (err) {
      setError(els.loginError, err.message);
    } finally {
      els.loginSubmit.disabled = false;
    }
  }

  async function handleLogout() {
    const session = loadSession();
    setError(els.uploadError, "");
    stopPolling();
    try {
      if (apiConfigured()) {
        await apiFetch("/auth/logout", { method: "POST" }, session);
      }
    } catch (_err) {
      // Still clear local session.
    }
    saveSession(null);
    renderSession(null);
    renderUploads([]);
  }

  async function handleFile(file) {
    setError(els.uploadError, "");
    if (!file) return;
    if (file.type && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError(els.uploadError, "Only PDF files are accepted.");
      return;
    }
    const session = loadSession();
    if (!session) {
      setError(els.uploadError, "Sign in to upload.");
      return;
    }

    els.dropzone.classList.add("is-uploading");
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      await apiFetch(
        "/api/uploads",
        {
          method: "POST",
          body,
          headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
        },
        session
      );
      await refreshUploads(session);
    } catch (err) {
      setError(els.uploadError, err.message);
    } finally {
      els.dropzone.classList.remove("is-uploading");
      els.fileInput.value = "";
    }
  }

  function wireDropzone() {
    const openPicker = () => {
      if (els.dropzone.classList.contains("is-uploading")) return;
      els.fileInput.click();
    };
    els.dropzone.addEventListener("click", openPicker);
    els.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPicker();
      }
    });
    els.fileInput.addEventListener("change", () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      handleFile(file);
    });
    ["dragenter", "dragover"].forEach((name) => {
      els.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        els.dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((name) => {
      els.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        els.dropzone.classList.remove("is-dragover");
      });
    });
    els.dropzone.addEventListener("drop", (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      handleFile(file);
    });
  }

  async function boot() {
    if (apiConfigured()) {
      setBanner(`Connected to upload API at ${apiBase}`, "connected");
    } else {
      setBanner(
        "Scaffold mode: set SITE_CONFIG.uploadApiBaseUrl in js/site-config.js to enable login and uploads against the backend.",
        "scaffold"
      );
    }

    const session = loadSession();
    renderSession(session);
    renderUploads([]);

    els.loginForm.addEventListener("submit", handleLogin);
    els.logoutBtn.addEventListener("click", handleLogout);
    wireDropzone();

    if (session && apiConfigured()) {
      try {
        const me = await apiFetch("/auth/me", { method: "GET" }, session);
        const username = (me.user && me.user.username) || me.username || session.username;
        saveSession({ ...session, username });
        renderSession(loadSession());
        await refreshUploads(loadSession());
      } catch (err) {
        if (err.status === 401) {
          saveSession(null);
          renderSession(null);
        }
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
