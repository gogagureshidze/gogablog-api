const express = require("express");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const userRoutes = require("./routes/user");
const jwt = require("jsonwebtoken");
const Post = require("./models/Post");
require("dotenv").config();
const User = require("./models/User");
const cloudinary = require("cloudinary").v2;

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://goga-blog.netlify.app",
];

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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use("/api/user", userRoutes);

// ── Generate signed upload signature ─────────────────────────────────────────
// Browser calls this, gets a signature, then uploads DIRECTLY to Cloudinary.
// Image bytes never touch your VPS.
app.post("/api/upload-signature", async (req, res) => {
  try {
    await verifyToken(req);

    const timestamp = Math.round(Date.now() / 1000);
    const folder = "gogablog";

    const paramsToSign = { folder, timestamp };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    );

    res.json({
      signature,
      timestamp,
      folder,
      api_key: process.env.CLOUDINARY_API_KEY, // ← correct
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("upload-signature error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── GET all posts ─────────────────────────────────────────────────────────────
app.get("/api/post", async (_req, res) => {
  try {
    const posts = await Post.find()
      .populate("author", ["username"])
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── GET single post ───────────────────────────────────────────────────────────
app.get("/api/post/:id", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("author", ["username"])
      .lean();
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── PUT update post ───────────────────────────────────────────────────────────
// Body: { id, title, summary, content, cover? }
// cover is a Cloudinary URL already uploaded by the browser — no multer needed
app.put("/api/post", async (req, res) => {
  try {
    await verifyToken(req);
    const { id, title, summary, content, cover } = req.body;

    const update = { title, summary, content };
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

// ── POST create post ──────────────────────────────────────────────────────────
// Body: { title, summary, content, cover? }
// ── PUT update post ───────────────────────────────────────────────────────────
app.put("/api/post", async (req, res) => {
  try {
    // 1. Get the user info from the token
    const info = await verifyToken(req); 
    const { id, title, summary, content, cover } = req.body;

    // 2. Find the post FIRST
    const postDoc = await Post.findById(id);
    if (!postDoc) return res.status(404).json({ error: "Post not found" });

    // 3. SECURITY CHECK: Is this user the actual author?
    // (We check info.id or info._id depending on how you signed your JWT)
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id || info._id);
    if (!isAuthor) return res.status(403).json({ error: "You are not the author of this post" });

    // 4. Update the post
    const update = { title, summary, content };
    if (cover) update.cover = cover;

    const updatedPost = await Post.findByIdAndUpdate(id, update, { new: true }).lean();
    res.json(updatedPost);

  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("PUT /api/post", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── DELETE post ───────────────────────────────────────────────────────────────
// ── DELETE post ───────────────────────────────────────────────────────────────
app.delete("/api/post/:id", async (req, res) => {
  try {
    const info = await verifyToken(req);
    
    const postDoc = await Post.findById(req.params.id);
    if (!postDoc) return res.status(404).json({ error: "Post not found" });

    // SECURITY CHECK: Is this user the actual author?
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id || info._id);
    if (!isAuthor) return res.status(403).json({ error: "You are not the author of this post" });

    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── POST add comment ──────────────────────────────────────────────────────────
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
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── DELETE comment ────────────────────────────────────────────────────────────
app.delete("/api/post/:postId/comment/:commentId", async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });
    post.comments = post.comments.filter((c) => c._id.toString() !== commentId);
    await post.save();
    res.json({ message: "Comment deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ── PUT edit comment ──────────────────────────────────────────────────────────
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
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Connected to database");
    app.listen(process.env.PORT, () =>
      console.log("Listening on port", process.env.PORT),
    );
  })
  .catch((err) => console.error("DB connection error:", err));
