require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { google } = require("googleapis");
const mime = require("mime-types");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const TOKEN_FILE = path.join(DATA_DIR, "google-token.json");
const STATE_COOKIE = "gdrive_oauth_state";
const MAX_MB = Math.max(1, Number(process.env.MAX_FILE_SIZE_MB || 100));
const PUBLIC_FILES = String(process.env.MAKE_FILES_PUBLIC || "true").toLowerCase() === "true";

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(ROOT, "public"), { index: "index.html" }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api/", limiter);

function getOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth is not configured. Fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env.");
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

function readToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch { return null; }
}
function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
}
function getDrive() {
  const token = readToken();
  if (!token) throw new Error("Google Drive is not connected yet. Open Settings and connect Google Drive.");
  const auth = getOAuthClient();
  auth.setCredentials(token);
  auth.on("tokens", (newTokens) => {
    const current = readToken() || {};
    saveToken({ ...current, ...newTokens });
  });
  return google.drive({ version: "v3", auth });
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 16) {
    return res.status(503).json({ error: "Set ADMIN_PASSWORD to a random value of at least 16 characters in .env before uploading." });
  }
  const supplied = req.get("x-admin-password") || "";
  if (!constantTimeEqual(supplied, expected)) return res.status(401).json({ error: "رمز مدیریت اشتباه است." });
  next();
}

function readIndex() {
  const p = path.join(DATA_DIR, "files.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}
function writeIndex(rows) {
  const p = path.join(DATA_DIR, "files.json");
  const temp = p + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(rows, null, 2), { mode: 0o600 });
  fs.renameSync(temp, p);
}
function safeError(err) {
  console.error(err);
  if (err && err.code === 401) return "دسترسی گوگل منقضی شده؛ دوباره Google Drive را متصل کنید.";
  return err?.message || "خطای غیرمنتظره رخ داد.";
}
async function getOrCreateFolder(drive) {
  const configPath = path.join(DATA_DIR, "drive-folder.json");
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const found = await drive.files.get({ fileId: saved.id, fields: "id,name,mimeType,trashed" });
    if (found.data && !found.data.trashed) return saved.id;
  } catch {}
  const name = process.env.DRIVE_FOLDER_NAME || "Public Downloads";
  const made = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
    fields: "id,name"
  });
  fs.writeFileSync(configPath, JSON.stringify({ id: made.data.id, name: made.data.name }, null, 2), { mode: 0o600 });
  return made.data.id;
}
function directUrl(id) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname || file.originalname.includes("\0")) return cb(new Error("نام فایل معتبر نیست."));
    cb(null, true);
  }
});

app.get("/api/status", (_req, res) => {
  const token = readToken();
  res.json({
    connected: Boolean(token),
    adminUploadEnabled: Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 16),
    maxFileSizeMB: MAX_MB,
    publicLinks: PUBLIC_FILES
  });
});

app.get("/auth/google", (_req, res) => {
  try {
    const oauth = getOAuthClient();
    const state = crypto.randomBytes(24).toString("hex");
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000, path: "/"
    });
    const url = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: ["https://www.googleapis.com/auth/drive.file"],
      state
    });
    res.redirect(url);
  } catch (e) { res.status(500).send(safeError(e)); }
});

app.get("/auth/google/callback", async (req, res) => {
  const cookieState = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith(STATE_COOKIE + "="))?.slice((STATE_COOKIE + "=").length);
  res.clearCookie(STATE_COOKIE, { path: "/" });
  if (!req.query.state || !cookieState || !constantTimeEqual(String(req.query.state), decodeURIComponent(cookieState))) {
    return res.status(400).send("OAuth state is invalid. Please go back and try connecting again.");
  }
  if (req.query.error) return res.status(400).send("Google authorization was cancelled or denied.");
  try {
    const oauth = getOAuthClient();
    const { tokens } = await oauth.getToken(String(req.query.code || ""));
    const previous = readToken() || {};
    saveToken({ ...previous, ...tokens });
    res.redirect("/?connected=1");
  } catch (e) { res.status(500).send(safeError(e)); }
});

app.get("/api/files", (_req, res) => {
  const rows = readIndex()
    .filter(x => !x.deleted)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .map(({ id, name, mimeType, size, uploadedAt, directUrl: url }) => ({ id, name, mimeType, size, uploadedAt, directUrl: url }));
  res.json({ files: rows });
});

app.post("/api/upload", requireAdmin, upload.single("file"), async (req, res) => {
  let tempPath = req.file?.path;
  if (!req.file) return res.status(400).json({ error: "ابتدا یک فایل انتخاب کنید." });
  try {
    const drive = getDrive();
    const folderId = await getOrCreateFolder(drive);
    const originalName = path.basename(req.file.originalname).slice(0, 240);
    const mimeType = req.file.mimetype || mime.lookup(originalName) || "application/octet-stream";
    const created = await drive.files.create({
      requestBody: { name: originalName, mimeType, parents: [folderId] },
      media: { mimeType, body: fs.createReadStream(tempPath) },
      fields: "id,name,mimeType,size,webViewLink"
    });
    if (PUBLIC_FILES) {
      await drive.permissions.create({
        fileId: created.data.id,
        requestBody: { type: "anyone", role: "reader" },
        fields: "id"
      });
    }
    const row = {
      id: created.data.id,
      name: created.data.name || originalName,
      mimeType: created.data.mimeType || mimeType,
      size: Number(created.data.size || req.file.size),
      uploadedAt: new Date().toISOString(),
      directUrl: directUrl(created.data.id),
      webViewLink: created.data.webViewLink || `https://drive.google.com/file/d/${created.data.id}/view`,
      deleted: false
    };
    const rows = readIndex();
    rows.push(row);
    writeIndex(rows);
    res.status(201).json({ file: { id: row.id, name: row.name, mimeType: row.mimeType, size: row.size, uploadedAt: row.uploadedAt, directUrl: row.directUrl } });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
  }
});

app.delete("/api/files/:id", requireAdmin, async (req, res) => {
  try {
    const rows = readIndex();
    const row = rows.find(x => x.id === req.params.id && !x.deleted);
    if (!row) return res.status(404).json({ error: "فایل پیدا نشد." });
    const drive = getDrive();
    await drive.files.delete({ fileId: row.id });
    writeIndex(rows.map(x => x.id === row.id ? { ...x, deleted: true } : x));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `حجم فایل از حد مجاز ${MAX_MB} مگابایت بیشتر است.` });
  }
  res.status(400).json({ error: err.message || "درخواست نامعتبر است." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Google Drive upload/download app listening on port ${PORT}`);
});
