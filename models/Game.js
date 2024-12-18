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
    createdAt: {
        type: Date,
        default: Date.now
    },
});

const Game = mongoose.model("Game", gameSchema);

module.exports = Game;