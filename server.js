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

// ─── Constants ───────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://goga-blog.netlify.app",
];

// Allowed MIME types AND their magic bytes (first 4–8 bytes)
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const MAGIC_BYTES = {
  ffd8ff: "image/jpeg", // JPEG
  "89504e47": "image/png", // PNG
  47494638: "image/gif", // GIF
  52494646: "image/webp", // WEBP (RIFF…WEBP)
};
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB raw upload ceiling
const COVER_MAX_WIDTH = 1200;
const COVER_MAX_HEIGHT = 800;
const COVER_QUALITY = 82; // WebP quality 0-100
const AVATAR_SIZE = 400; // px, square

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

/**
 * Upload a Buffer directly to Cloudinary (no temp file, no disk I/O).
 * Returns the secure_url string.
 */
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

// ─── Magic-byte validator ─────────────────────────────────────────────────────
/**
 * Inspect the first 8 bytes of the buffer to confirm it really is an image.
 * Returns true if valid, false otherwise.
 */
function hasValidMagicBytes(buffer) {
  const hex = buffer.slice(0, 8).toString("hex");
  return Object.keys(MAGIC_BYTES).some((magic) => hex.startsWith(magic));
}

// ─── Multer (memory storage – no disk writes) ─────────────────────────────────
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  },
});

// ─── Image processing helper ──────────────────────────────────────────────────
/**
 * Process a cover image with Sharp:
 *  - Strips EXIF / metadata (privacy + size)
 *  - Resizes to fit within COVER_MAX_WIDTH × COVER_MAX_HEIGHT (no upscale)
 *  - Converts to WebP for best compression & speed
 * Returns a Buffer ready for Cloudinary upload.
 */
async function processCoverImage(buffer) {
  return sharp(buffer)
    .rotate() // auto-rotate via EXIF then strip
    .resize(COVER_MAX_WIDTH, COVER_MAX_HEIGHT, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: COVER_QUALITY })
    .toBuffer();
}

/**
 * Shared upload pipeline:
 *  1. Magic-byte check
 *  2. Sharp processing
 *  3. Cloudinary upload
 * Returns the secure CDN URL.
 */
async function validateProcessAndUpload(file, folder = "gogablog") {
  if (!hasValidMagicBytes(file.buffer)) {
    const err = new Error(
      "File content does not match a supported image type.",
    );
    err.status = 422;
    throw err;
  }
  const processed = await processCoverImage(file.buffer);
  return uploadBufferToCloudinary(processed, folder);
}

// ─── Multer error handler middleware ─────────────────────────────────────────
function handleUploadError(err, _req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
        });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message && err.message.startsWith("Unsupported file type")) {
    return res
      .status(415)
      .json({ error: err.message + ". Allowed: JPEG, PNG, WebP, GIF." });
  }
  if (err && err.status === 422) {
    return res.status(422).json({ error: err.message });
  }
  next(err);
}

// ─── JWT helper ───────────────────────────────────────────────────────────────
function verifyToken(req) {
  return new Promise((resolve, reject) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" })); // tightened – JSON bodies don't need 5 MB
app.use("/api/user", userRoutes);

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET all posts
app.get("/api/post", async (_req, res) => {
  try {
    const posts = await Post.find()
      .populate("author", ["username"])
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(); // lean() = plain JS objects, faster
    res.json(posts);
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET single post
app.get("/api/post/:id", async (req, res) => {
  try {
    const postDoc = await Post.findById(req.params.id)
      .populate("author", ["username"])
      .lean();
    if (!postDoc) return res.status(404).json({ error: "Post not found" });
    res.json(postDoc);
  } catch (error) {
    console.error("Error fetching post:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT update post (with optional cover image replacement)
app.put(
  "/api/post",
  uploadMiddleware.single("file"),
  handleUploadError,
  async (req, res) => {
    try {
      const info = await verifyToken(req);
      const { id, title, summary, content } = req.body;
      const updatedPost = { title, summary, content };

      if (req.file) {
        // Validate + process + upload in one pipeline — instant for the user
        updatedPost.cover = await validateProcessAndUpload(req.file);
      }

      const post = await Post.findByIdAndUpdate(id, updatedPost, { new: true });
      if (!post) return res.status(404).json({ error: "Post not found" });

      res.json(post);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      console.error("Error updating post:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// POST create post
app.post(
  "/api/post",
  uploadMiddleware.single("file"),
  handleUploadError,
  async (req, res) => {
    try {
      const info = await verifyToken(req);
      const { title, summary, content } = req.body;
      let cover = "";

      if (req.file) {
        cover = await validateProcessAndUpload(req.file);
      }

      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover,
        author: info._id,
      });

      res.status(201).json(postDoc);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      console.error("Error creating post:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// DELETE post
app.delete("/api/post/:id", async (req, res) => {
  try {
    const info = await verifyToken(req);
    const result = await Post.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: "Post not found" });
    res.json({ message: "Deleted successfully" });
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("Error deleting post:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST add comment
app.post("/api/post/:id/comment", async (req, res) => {
  try {
    const { username, text } = req.body;
    if (!username || !text) {
      return res.status(400).json({ error: "Missing username or text" });
    }
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.comments.push({ username, text });
    await post.save();
    res.status(201).json(post);
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// DELETE comment
app.delete("/api/post/:postId/comment/:commentId", async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.comments = post.comments.filter((c) => c._id.toString() !== commentId);
    await post.save();
    res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT edit comment
app.put("/api/post/:postId/comment/:commentId", async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { text } = req.body;
    if (!text)
      return res
        .status(400)
        .json({ error: "Missing new text for the comment" });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    comment.text = text;
    await post.save();
    res.json({ message: "Comment updated successfully", post });
  } catch (error) {
    console.error("Error editing comment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ─── MongoDB + server start ───────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Connected to the database");
    app.listen(process.env.PORT, () => {
      console.log("Listening on port", process.env.PORT);
    });
  })
  .catch((err) => console.error("DB connection error:", err));
