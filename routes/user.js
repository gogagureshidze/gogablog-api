const express = require("express");
const router = express.Router();
const {
  registerUser,
  loginUser,
  forgotPassword,
  validateToken,
  resetPassword,
} = require("../controllers/userController");

router.post("/login", loginUser);
router.post("/register", registerUser);
router.post("/forgotPassword", forgotPassword);
router.post("/validate", validateToken);
router.post("/reset", resetPassword);

module.exports = router;
