const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    googleId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    avatar: String,
    points: {
        type: Number,
        default: 0
    },
    level: {
        type: Number,
        default: 1
    },
    gameHistory: [{
        word: String,
        won: Boolean,
        timestamp: {
            type: Date,
            default: Date.now
        },
    }],
});

const User = mongoose.model("User", userSchema);

module.exports = User;