const express = require("express");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const userRoutes = require("./routes/user");
const jwt = require("jsonwebtoken");
const Post = require("./models/Post");
const multer = require("multer");
const sharp = require("sharp");
require("dotenv").config();
const User = require("./models/User");
const cloudinary = require("cloudinary").v2;
const { Readable } = require("stream");

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://goga-blog.netlify.app",
];
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const MAGIC_BYTES = {
  ffd8ff: "image/jpeg",
  "89504e47": "image/png",
  47494638: "image/gif",
  52494646: "image/webp",
};
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const COVER_MAX_WIDTH = 1200;
const COVER_MAX_HEIGHT = 800;
const COVER_QUALITY = 80;

// ─── Tiny timing helper ───────────────────────────────────────────────────────
// Prints label + elapsed ms since the last tick() call.
// Usage:  const tick = timer("PUT /api/post");
//         tick("jwt verified");   →  [PUT /api/post] jwt verified — 3ms
//         tick("db saved");       →  [PUT /api/post] db saved — 47ms
//         tick.total();           →  [PUT /api/post] TOTAL — 52ms
function timer(label) {
  let last = Date.now();
  const start = last;
  const tick = (step) => {
    const now = Date.now();
    console.log(`  [${label}] ${step} — ${now - last}ms`);
    last = now;
  };
  tick.total = () =>
    console.log(`  [${label}] ✓ TOTAL — ${Date.now() - start}ms`);
  return tick;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin))
        return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

// ─── Cloudinary ───────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Multer — memory storage, strict limits ───────────────────────────────────
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(
      Object.assign(new Error(`Unsupported type: ${file.mimetype}`), {
        code: "BAD_TYPE",
      }),
      false,
    );
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hasValidMagicBytes(buffer) {
  const hex = buffer.slice(0, 8).toString("hex");
  return Object.keys(MAGIC_BYTES).some((m) => hex.startsWith(m));
}

function uploadBufferToCloudinary(buffer, folder = "gogablog") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", format: "webp" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      },
    );
    Readable.from(buffer).pipe(stream);
  });
}

async function processAndUpload(file, tick, folder = "gogablog") {
  if (!hasValidMagicBytes(file.buffer)) {
    throw Object.assign(
      new Error("File content does not match a supported image."),
      { status: 422 },
    );
  }

  const processed = await sharp(file.buffer)
    .rotate()
    .resize(COVER_MAX_WIDTH, COVER_MAX_HEIGHT, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: COVER_QUALITY })
    .toBuffer();

  tick(`sharp done (${(processed.length / 1024).toFixed(0)} KB output)`);

  const url = await uploadBufferToCloudinary(processed, folder);
  tick("cloudinary upload done");

  return url;
}

function verifyToken(req) {
  return new Promise((resolve, reject) => {
    const token = (req.headers.authorization || "").split(" ")[1];
    if (!token)
      return reject(
        Object.assign(new Error("No token provided"), { status: 401 }),
      );
    jwt.verify(token, process.env.JWT_SECRET, {}, (err, info) => {
      if (err)
        return reject(
          Object.assign(new Error("Invalid token"), { status: 403 }),
        );
      resolve(info);
    });
  });
}

// ─── Multer error handler ─────────────────────────────────────────────────────
function handleUploadError(err, _req, res, next) {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
    return res
      .status(413)
      .json({
        error: `Max file size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
      });
  if (err?.code === "BAD_TYPE")
    return res
      .status(415)
      .json({ error: err.message + " — allowed: JPEG, PNG, WebP, GIF." });
  if (err?.status === 422) return res.status(422).json({ error: err.message });
  next(err);
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use("/api/user", userRoutes);

// ─── GET all posts ────────────────────────────────────────────────────────────
app.get("/api/post", async (_req, res) => {
  try {
    const posts = await Post.find()
      .populate("author", ["username"])
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json(posts);
  } catch (err) {
    console.error("GET /api/post", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── GET single post ──────────────────────────────────────────────────────────
app.get("/api/post/:id", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("author", ["username"])
      .lean();
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  } catch (err) {
    console.error("GET /api/post/:id", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── PUT update post ──────────────────────────────────────────────────────────
app.put(
  "/api/post",
  uploadMiddleware.single("file"),
  handleUploadError,
  async (req, res) => {
    const tick = timer("PUT /api/post");
    try {
      await verifyToken(req);
      tick("jwt verified");

      const { id, title, summary, content } = req.body;

      // ── TEXT-ONLY: no file → instant DB update ────────────────────────────
      if (!req.file) {
        const post = await Post.findByIdAndUpdate(
          id,
          { title, summary, content },
          { new: true },
        ).lean();
        tick("db updated");
        if (!post) return res.status(404).json({ error: "Post not found" });
        tick.total();
        return res.json(post);
      }

      // ── WITH IMAGE ────────────────────────────────────────────────────────
      tick(
        `file received (${(req.file.buffer.length / 1024).toFixed(0)} KB raw)`,
      );
      const coverUrl = await processAndUpload(req.file, tick);

      const post = await Post.findByIdAndUpdate(
        id,
        { title, summary, content, cover: coverUrl },
        { new: true },
      ).lean();
      tick("db updated");

      if (!post) return res.status(404).json({ error: "Post not found" });
      tick.total();
      res.json(post);
    } catch (err) {
      if (err.status)
        return res.status(err.status).json({ error: err.message });
      console.error("PUT /api/post error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// ─── POST create post ─────────────────────────────────────────────────────────
app.post(
  "/api/post",
  uploadMiddleware.single("file"),
  handleUploadError,
  async (req, res) => {
    const tick = timer("POST /api/post");
    try {
      const info = await verifyToken(req);
      tick("jwt verified");

      const { title, summary, content } = req.body;
      if (!title || !summary || !content) {
        return res
          .status(400)
          .json({ error: "title, summary, and content are required." });
      }

      let cover = "";
      if (req.file) {
        tick(
          `file received (${(req.file.buffer.length / 1024).toFixed(0)} KB raw)`,
        );
        cover = await processAndUpload(req.file, tick);
      }

      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover,
        author: info._id,
      });
      tick("db created");
      tick.total();
      res.status(201).json(postDoc);
    } catch (err) {
      if (err.status)
        return res.status(err.status).json({ error: err.message });
      console.error("POST /api/post error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// ─── DELETE post ──────────────────────────────────────────────────────────────
app.delete("/api/post/:id", async (req, res) => {
  try {
    await verifyToken(req);
    const result = await Post.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: "Post not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("DELETE /api/post/:id", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── POST add comment ─────────────────────────────────────────────────────────
app.post("/api/post/:id/comment", async (req, res) => {
  try {
    const { username, text } = req.body;
    if (!username || !text)
      return res.status(400).json({ error: "Missing username or text" });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.comments.push({ username, text });
    await post.save();
    res.status(201).json(post);
  } catch (err) {
    console.error("POST comment", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── DELETE comment ───────────────────────────────────────────────────────────
app.delete("/api/post/:postId/comment/:commentId", async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.comments = post.comments.filter((c) => c._id.toString() !== commentId);
    await post.save();
    res.json({ message: "Comment deleted successfully" });
  } catch (err) {
    console.error("DELETE comment", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── PUT edit comment ─────────────────────────────────────────────────────────
app.put("/api/post/:postId/comment/:commentId", async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { text } = req.body;
    if (!text)
      return res.status(400).json({ error: "Missing new text for comment" });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    comment.text = text;
    await post.save();
    res.json({ message: "Comment updated successfully", post });
  } catch (err) {
    console.error("PUT comment", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ─── MongoDB + start ──────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Connected to database");
    app.listen(process.env.PORT, () =>
      console.log("Listening on port", process.env.PORT),
    );
  })
  .catch((err) => console.error("DB connection error:", err));
