const express = require("express");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const userRoutes = require("./routes/user");
const jwt = require("jsonwebtoken");
const Post = require("./models/Post");
const crypto = require("crypto");
require("dotenv").config();
const User = require("./models/User");
const cloudinary = require("cloudinary").v2;

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://goga-blog.netlify.app",
];

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

// ─── JWT helper ───────────────────────────────────────────────────────────────
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use("/api/user", userRoutes);

// ─── NEW: Generate a signed Cloudinary upload signature ───────────────────────
// The browser calls this first, gets a short-lived signature,
// then uploads the image DIRECTLY to Cloudinary — your VPS never handles image bytes.
//
// POST /api/upload-signature
// Returns: { signature, timestamp, api_key, cloud_name, folder }
app.post("/api/upload-signature", async (req, res) => {
  try {
    await verifyToken(req);

    const timestamp = Math.round(Date.now() / 1000);
    const folder = "gogablog";

    // Parameters that must be signed — must match exactly what the browser sends
    const paramsToSign = {
      folder,
      timestamp,
      // Restrict what can be uploaded: images only, max 8 MB
      // These are Cloudinary upload parameters enforced server-side
      allowed_formats: "jpg,jpeg,png,webp,gif",
      max_file_size: 8388608, // 8 MB in bytes
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    );

    res.json({
      signature,
      timestamp,
      folder,
      api_key: process.env.CLOUDINARY_CLOUD_NAME, // not a secret
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      allowed_formats: paramsToSign.allowed_formats,
      max_file_size: paramsToSign.max_file_size,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("upload-signature error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

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
// No multer — the browser already uploaded the image to Cloudinary.
// The request body just contains { id, title, summary, content, cover? }
// where cover is already a Cloudinary URL the browser got back directly.
app.put("/api/post", async (req, res) => {
  try {
    await verifyToken(req);
    const { id, title, summary, content, cover } = req.body;

    const update = { title, summary, content };
    // Only update cover if a new URL was provided
    if (cover) update.cover = cover;

    const post = await Post.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    res.json(post);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("PUT /api/post", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── POST create post ─────────────────────────────────────────────────────────
// Same pattern — cover is a Cloudinary URL already uploaded by the browser.
app.post("/api/post", async (req, res) => {
  try {
    const info = await verifyToken(req);
    const { title, summary, content, cover } = req.body;

    if (!title || !summary || !content) {
      return res
        .status(400)
        .json({ error: "title, summary, and content are required." });
    }

    const postDoc = await Post.create({
      title,
      summary,
      content,
      cover: cover || "",
      author: info._id,
    });

    res.status(201).json(postDoc);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("POST /api/post", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

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
