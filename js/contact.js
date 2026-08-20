/**
 * Contact form delivery.
 *
 * Web3Forms sends one submission to one verified inbox, so reaching every
 * maintainer means posting once per configured access key. Until keys are
 * configured the form degrades to composing a plain mail-client message, which
 * keeps the page useful rather than broken.
 */
(function () {
  "use strict";

  const ENDPOINT = "https://api.web3forms.com/submit";

  const form = document.getElementById("contact-form");
  const result = document.getElementById("contact-result");
  const submitButton = document.getElementById("contact-submit");

  function config() {
    return window.SITE_CONFIG?.contact ?? {};
  }

  function accessKeys() {
    const keys = config().accessKeys;
    return (Array.isArray(keys) ? keys : [])
      .map((key) => String(key ?? "").trim())
      .filter(Boolean);
  }

  function recipients() {
    const cfg = window.SITE_CONFIG ?? {};
    const list = Array.isArray(cfg.feedbackEmails) ? cfg.feedbackEmails : [cfg.unverified_feedback_email];
    return list.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  function renderDirectEmails() {
    const host = document.getElementById("contact-direct-emails");
    const emails = recipients();
    host.replaceChildren();
    if (!emails.length) {
      host.textContent = "Maintainer addresses are listed on the problem pages.";
      return;
    }
    emails.forEach((email, index) => {
      if (index > 0) host.appendChild(document.createTextNode(" · "));
      const link = document.createElement("a");
      link.href = `mailto:${email}`;
      link.textContent = email;
      host.appendChild(link);
    });
  }

  function say(message, variant) {
    result.hidden = false;
    result.className = `contact-result${variant ? ` contact-result-${variant}` : ""}`;
    result.textContent = message;
  }

  function readForm() {
    const data = new FormData(form);
    return {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      userSubject: String(data.get("user_subject") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      trapped: Boolean(data.get("botcheck")),
    };
  }

  function validate(fields) {
    if (!fields.name) return "Please add your name.";
    if (!fields.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
      return "Please add a valid email address so we can reply.";
    }
    if (!fields.message) return "Please write a message.";
    return "";
  }

  function subjectFor(fields) {
    const base = String(config().subject ?? "Website message").trim();
    return fields.userSubject ? `${base}: ${fields.userSubject}` : base;
  }

  /** No access keys configured: hand the message to the visitor's mail client. */
  function sendViaMailto(fields) {
    const to = recipients().join(",");
    if (!to) {
      say("This form is not configured yet. Please use the addresses listed on the problem pages.", "error");
      return;
    }
    const body = `${fields.message}\n\n— ${fields.name} <${fields.email}>`;
    const href = `mailto:${to}?subject=${encodeURIComponent(subjectFor(fields))}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    say("Opening your email app with this message ready to send.");
  }

  /**
   * Sent as FormData rather than JSON: a JSON body triggers a CORS preflight,
   * and the endpoint does not answer preflights reliably. FormData is a
   * CORS-safelisted content type, so the POST goes straight out.
   */
  async function postTo(key, fields) {
    const body = new FormData();
    body.append("access_key", key);
    body.append("name", fields.name);
    body.append("email", fields.email);
    body.append("subject", subjectFor(fields));
    body.append("from_name", config().fromName ?? "Open Problems in OR");
    body.append("message", fields.message);

    const response = await fetch(ENDPOINT, { method: "POST", body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || `Request failed (${response.status})`);
    }
    return true;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const fields = readForm();
    if (fields.trapped) return;

    const problem = validate(fields);
    if (problem) {
      say(problem, "error");
      return;
    }

    const keys = accessKeys();
    if (!keys.length) {
      sendViaMailto(fields);
      return;
    }

    submitButton.disabled = true;
    say("Sending…");

    const outcomes = await Promise.allSettled(keys.map((key) => postTo(key, fields)));
    const delivered = outcomes.filter((o) => o.status === "fulfilled").length;
    submitButton.disabled = false;

    if (delivered === keys.length) {
      say("Thank you — your message has been sent. We will get back to you at the address you gave.", "success");
      form.reset();
    } else if (delivered > 0) {
      say("Your message reached some of us but not all. We have it, and will follow up.", "success");
      form.reset();
    } else {
      const reason = outcomes.find((o) => o.status === "rejected")?.reason;
      say(`Sorry — the message could not be sent (${reason?.message ?? "unknown error"}). Please email us directly instead.`, "error");
    }
  }

  renderDirectEmails();
  form.addEventListener("submit", handleSubmit);
})();
