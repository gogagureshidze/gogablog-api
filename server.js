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
require("dotenv").config();

const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "gogablog", // Folder name inside Cloudinary
    resource_type: "image",
  },
});
const uploadMiddleware = multer({ storage });

const corsOptions = {
  origin: [
    "https://gogagureshidze.github.io",
    "https://gogagureshidze.github.io/gogablog-client",
    "http://localhost:3000",
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" })); // Adjust the limit as needed
app.use("/api/user", userRoutes);
app.use("/uploads", express.static("uploads"));

// Get all posts endpoint
app.get("/api/post", async (req, res) => {
  res.json(
    await Post.find()
      .populate("author", ["username"])
      .sort({ createdAt: -1 })
      .limit(20)
  );
});

// Get a single post by id
app.get("/api/post/:id", async (req, res) => {
  const { id } = req.params;
  const postDoc = await Post.findById(id).populate("author", ["username"]);

  res.status(200).json(postDoc);
});

// Update post
app.put("/api/post", uploadMiddleware.single("file"), async (req, res) => {
  const { id, title, summary, content } = req.body;
  const updatedPost = { title, summary, content };

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, {}, async (err, info) => {
    if (err) return res.status(403).json({ error: "Invalid token" });

    try {
      if (req.file && req.file.path) {
        updatedPost.cover = req.file.path; // ✅ Cloudinary URL
      }

      const post = await Post.findByIdAndUpdate(id, updatedPost, { new: true });
      if (!post) return res.status(404).json({ message: "Post not found" });

      res.json(post);
    } catch (error) {
      console.error("Error updating post:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
});

// Create a new post
app.post("/api/post", uploadMiddleware.single("file"), async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, {}, async (err, info) => {
    if (err) return res.status(403).json({ error: "Invalid token" });

    try {
      const { title, summary, content } = req.body;
      let cover = "";

      if (req.file && req.file.path) {
        cover = req.file.path; // ✅ Cloudinary URL
      }

      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover,
        author: info._id,
      });

      res.json(postDoc);
    } catch (error) {
      console.error("Error creating post:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
});

// Delete a post by id
app.delete("/api/post/:id", async (req, res) => {
  const { id } = req.params;
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, {}, async (err, info) => {
    if (err) {
      throw err;
    }

    await Post.findByIdAndDelete(id)
      .then((result) => {
        if (!result) {
          res.json("Document not found");
        }
        res.json("Deleted Successfully");
      })
      .catch((err) => {
        res.status(500).json(err);
        console.log(err.message);
      });
  });
});

app.post("/api/post/:id/comment", async (req, res) => {
  try {
    const { username, text } = req.body;
    const postId = req.params.id;

    if (!username || !text) {
      return res.status(400).json({ error: "Missing username or text" });
    }
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    post.comments.push({ username, text });
    await post.save();

    res.status(201).json(post);
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.delete("/api/post/:postId/comment/:commentId", async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    post.comments = post.comments.filter(
      (comment) => comment._id.toString() !== commentId
    );

    await post.save();
    res.status(200).json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.put("/api/post/:postId/comment/:commentId", async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { text } = req.body; // New comment text

    if (!text) {
      return res
        .status(400)
        .json({ error: "Missing new text for the comment" });
    }

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Find the specific comment
    const comment = post.comments.id(commentId);

    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Update the comment text
    comment.text = text;

    // Save the updated post
    await post.save();

    res.status(200).json({ message: "Comment updated successfully", post });
  } catch (error) {
    console.error("Error editing comment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// MongoDB connection

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("connected to the database");
    app.listen(process.env.PORT, () => {
      console.log("listening for requests on port", process.env.PORT);
    });
  })
  .catch((err) => {
    console.log(err);
  });
