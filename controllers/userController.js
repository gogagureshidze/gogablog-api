const validator = require("validator");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { mail } = require("../smtp");

const leo = require("leo-profanity")

const createToken = (_id) => {
  return jwt.sign({ _id }, process.env.JWT_SECRET, { expiresIn: "3d" });
};

const registerUser = async (req, res) => {
  const { username, email, password } = req.body;

  try {
    if (!username || !email || !password) {
      throw Error("Fill all the required Fields!");
    }

    if (!validator.isEmail(email)) {
      throw Error("Invalid Email");
    }

    if (!validator.isStrongPassword(password)) {
      throw Error(
        "Password must contain at least 8 characters, including uppercase, lowercase, numbers and special characters. (Password Is Not Strong Enough😴)"
      );
    }

    if (
      !validator.isLength(username, { min: 3, max: 16 }) ||
      !/^[a-zA-Z0-9_.]+$/.test(username)
    ) {
      throw Error(
        "Username must be 3-16 characters long and contain only letters, numbers, underscores, or dots."
      );
    }

    const filter = leo;
    if (filter.check(username)) {
      throw Error("Username contains inappropriate language. Try another one.");
    }

    const existEmail = await User.findOne({ email });
    if (existEmail) {
      throw Error("Email already exists!");
    }

    const existsUsername = await User.findOne({ username });
    if (existsUsername) {
      throw Error("Username already taken!");
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const newUser = new User({
      email,
      password: hash,
      username,
    });

    await newUser.save();

    const token = createToken(newUser._id);

    res.status(201).json({
      message: "User registered successfully.",
      token,
      user: {
        _id: newUser._id,
        email: newUser.email,
        username: newUser.username,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!validator.isEmail(email)) {
      throw Error("Invalid email!");
    }

    if (!email || !password) {
      throw Error("Fill all the required fields!");
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw Error("Email not found!");
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      throw Error("Incorrect password!");
    }

    const token = createToken(user._id);

    res.status(200).json({ user, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error.message);
  }
};


const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Fill the required field!" });
  }
  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: "Invalid email format." });
  }

  try {
    //ALL EMAIL FETCHING LOGIC
    const users = await User.find({}, { email: 1, _id: 0 });
    const emails = users.map((user) => user.email);

    if (!emails.includes(email)) {
      return res.status(404).json({ error: "Email not found!" });
    }

    // Find the user and generate the reset token
    const user = await User.findOne({ email });
    const userId = user._id;
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const link = `https://gogagureshidze.github.io/gogablog-client/#/api/reset-password/${user._id}/${token}`;
    console.log(link);
    await mail(user, link);

    return res.status(200).json({
      email,
      link,
      response: "Password reset link has been sent to your email address!",
    });
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const validateToken = (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res
      .status(400)
      .json({ success: false, message: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res
      .status(200)
      .json({ success: true, message: "Token is valid.", userId: decoded.id });
  } catch (err) {
    res
      .status(401)
      .json({ success: false, message: "Invalid or expired token." });
  }
};


const resetPassword = async (req, res) => {
  const { userId, password, token } = req.body;

  if (!password || !token) {
    return res.status(400).json({ error: "Fill all the required fields!" });
  }
  if (!validator.isStrongPassword(password)) {
    return res.status(400).json({ error: "Password is not strong enough!" });
  }
  const salt = bcrypt.genSaltSync(15);
  const hash = bcrypt.hashSync(password, salt);
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByIdAndUpdate(
      userId,
      { password: hash },
      { new: true }
    );
    res.status(200).json({ user });
  } catch (error) {
    console.error("Error!", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


module.exports = {
  registerUser,
  loginUser,
  forgotPassword,
  validateToken,
  resetPassword,
}
