// Preloaded by `npm test` (see package.json). Tests must never send real email, even when a key is in .env:
// dotenv does not override a variable that is already set, so this blanks it for every test process.
process.env.RESEND_API_KEY = "";
process.env.WEBHOOK_SECRET = "";
