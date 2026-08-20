/**
 * Site-wide settings for the static site. Edit here — do not duplicate in llm export JSON.
 */
window.SITE_CONFIG = Object.freeze({
  /** Shown on the unverified-entry banners; every address is listed as a mailto link. */
  feedbackEmails: Object.freeze([
    "rad.niazadeh@chicagobooth.edu",
    "pranav.nuti@chicagobooth.edu",
  ]),
  defaultJournal: "Mathematics of Operations Research",
  journals: [
    {
      value: "Mathematics of Operations Research",
      shortLabel: "Mathematics of Operations Research",
    },
    {
      value: "Economics and Computation (EC)",
      shortLabel: "Economics and Computation (EC)",
    },
  ],
  /**
   * Backend base URL for login-protected uploads (no trailing slash).
   * Production: Railway FastAPI service. Local API is http://127.0.0.1:8081.
   */
  uploadApiBaseUrl: "https://open-problems-in-or-production.up.railway.app",

  /**
   * Contact form delivery via Web3Forms (https://web3forms.com), which lets a
   * static site email a form without a server.
   *
   * One access key delivers to exactly one verified inbox on the free plan, so
   * list one key per recipient and the form posts to each. Create a key at
   * web3forms.com (no account needed — it is emailed to you after verification).
   * Keys are safe to commit: they are aliases for an address, not secrets.
   *
   * While this list is empty the Contact page falls back to plain mailto links,
   * so the page is still usable before the keys are filled in.
   */
  contact: Object.freeze({
    accessKeys: Object.freeze([
      "d455d09e-6f92-4d38-94e3-3163e7f666fc", // Rad
      // Add Pranav's key here so submissions reach him too.
    ]),
    subject: "Open Problems in OR — website message",
    fromName: "Open Problems in OR",
  }),
});
