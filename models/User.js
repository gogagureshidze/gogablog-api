const mongoose = require('mongoose')


const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    min: 4,
    unique: true,
  },
  email: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  isAdmin: {
    type: Boolean,
    default: false, 
  },
});


module.exports = mongoose.model("User", UserSchema);
