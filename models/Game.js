const mongoose = require("mongoose");

const gameSchema = new mongoose.Schema({
    _id: {
        type: String,
        required: true
    }, // Use gameId as _id
    players: [{
        type: String,
        ref: "User"
    }], // Array of user IDs
    wordLength: {
        type: Number,
        required: true
    },
    gameState: {
        type: String,
        enum: ["waiting", "in-progress", "completed"],
        default: "waiting",
    },
    currentWord: {
        type: String,
        default: null
    },
    currentTurn: {
        type: String,
        ref: "User"
    },
    guessedLetters: [{
        type: String
    }],
    guessesLeft: {
        type: Number,
        default: 6
    },
    winner: {
        type: String,
        ref: "User",
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400 // Automatically delete after 24 hours
    }
});

const Game = mongoose.model("Game", gameSchema);

module.exports = Game;