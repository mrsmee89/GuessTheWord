require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");
const session = require("express-session");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const MongoDBStore = require("connect-mongodb-session")(session);
const User = require("./models/User"); // User model
const Game = require("./models/Game"); // Game model

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Database ---
mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connection error:", err));

// --- Session Store (MongoDB) ---
const store = new MongoDBStore({
    uri: process.env.MONGODB_URI,
    collection: "sessions",
});

store.on("error", (error) => {
    console.error("MongoDBStore Error:", error);
});

// --- Google Authentication ---
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        return ticket.getPayload();
    } catch (error) {
        console.error("Error verifying Google token:", error);
        throw new Error("Invalid Google token");
    }
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());
app.use(
    session({
        secret: process.env.SESSION_SECRET, // Use a strong secret in production
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production", // Secure in production
            maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
            httpOnly: true,
            sameSite: "strict",
        },
        store: store,
    })
);

// --- API Routes ---

// --- Authentication Route ---
app.post("/auth/google", async (req, res) => {
    try {
        const { credential } = req.body;
        const payload = await verifyGoogleToken(credential);

        let user = await User.findOne({ googleId: payload.sub });
        if (!user) {
            // Create new user
            user = new User({
                googleId: payload.sub,
                name: payload.name,
                email: payload.email,
                avatar: payload.picture,
                points: 0,
                level: 1,
                gameHistory: [],
            });
        } else {
            // Update existing user data
            user.name = payload.name;
            user.email = payload.email;
            user.avatar = payload.picture;
        }
        await user.save();

        // Create JWT token
        const token = jwt.sign(
            {
                userId: user.googleId,
                name: user.name,
                email: user.email,
                picture: user.avatar,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "7d",
            }
        );

        // Set session
        req.session.userId = user.googleId;
        // Set JWT cookie
        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: "/", // Ensure the cookie is accessible from all paths
        });
        // Ensure the cookie is set before sending the response
        res.cookie("token", token);
        // Send user data back to client
        res.json({
            id: user.googleId,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            points: user.points,
            level: user.level,
        });
    } catch (error) {
        console.error("Authentication error:", error);
        res.status(401).send(error.message);
    }
});

// --- Session Check Route ---
app.get("/api/check-session", async (req, res) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return res.status(200).json({ isAuthenticated: false });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Optionally, fetch the user from the database to ensure it exists
        const user = await User.findOne({ googleId: decoded.userId });
        if (!user) {
            return res.status(401).json({
                isAuthenticated: false,
                message: "User not found",
            });
        }

        // Extend the session on each request
        req.session.touch();

        res.json({
            isAuthenticated: true,
            userId: user.googleId,
            name: user.name,
            email: user.email,
            picture: user.avatar,
            // Add any other user-specific data here
        });
    } catch (error) {
        console.error("Session check error:", error);
        res.clearCookie("token");
        res.status(401).json({
            isAuthenticated: false,
            message: "Session check failed",
        });
    }
});

// --- Logout Route ---
app.post("/auth/logout", (req, res) => {
    // Clear session
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: "Logout failed" });
        }

        // Clear cookie
        res.clearCookie("token");
        res.status(200).json({ message: "Logged out successfully" });
    });
});

// --- Config Route ---
app.get("/api/config", (req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
        return res
            .status(500)
            .json({ error: "Google Client ID not configured" });
    }
    res.json({ googleClientId });
});

// --- User Data Routes ---

// GET /api/user/:userId - Get user data by Google ID
app.get("/api/user/:userId", async (req, res) => {
    try {
        const user = await User.findOne({ googleId: req.params.userId });
        if (!user) {
            return res.status(404).send("User not found");
        }

        res.json({
            id: user.googleId,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            points: user.points,
            level: user.level,
            gameHistory: user.gameHistory,
        });
    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).send("Internal Server Error");
    }
});

// POST /api/user/:userId/update-score - Update user score and game history
app.post("/api/user/:userId/update-score", async (req, res) => {
    try {
        const { points, level, word, won } = req.body;
        const user = await User.findOne({ googleId: req.params.userId });
        if (!user) {
            return res.status(404).send("User not found");
        }

        user.points += points;
        user.level = Math.max(user.level, level);
        user.gameHistory.push({ word, won, timestamp: new Date() });

        await user.save();
        res.json({
            message: "Score updated successfully",
            points: user.points,
            level: user.level,
        });
    } catch (error) {
        console.error("Error updating user score:", error);
        res.status(500).send("Internal Server Error");
    }
});

// --- Word, Image, and Definition Fetching ---

const wordApiUrl = "https://random-word-api.herokuapp.com/word";
const imageApiUrl = "https://api.unsplash.com/search/photos?query=";
const definitionApiUrl =
    "https://api.dictionaryapi.dev/api/v2/entries/en/";

// --- Word Fetching Route ---
app.get("/api/word", async (req, res) => {
    const length = req.query.length || 5; // Default to 5 if not specified
    try {
        const response = await fetch(`${wordApiUrl}?number=1&length=${length}`);
        const data = await response.json();
        const word = data[0];
        const definition = await fetchWordDefinition(word);
        res.json({ word, definition });
    } catch (error) {
        console.error("Error fetching word:", error);
        res.status(500).send("Error fetching word");
    }
});

async function fetchWordDefinition(word) {
    try {
        const response = await fetch(`${definitionApiUrl}${word}`);
        const data = await response.json();

        if (data[0]?.meanings[0]?.definitions[0]?.definition) {
            return data[0].meanings[0].definitions[0].definition;
        } else {
            return "Definition not found.";
        }
    } catch (error) {
        console.error("Error fetching definition:", error);
        return "Definition not found.";
    }
}

async function fetchImageForWord(word) {
    try {
        const response = await fetch(
            `${imageApiUrl}${word}&client_id=${process.env.UNSPLASH_API_KEY}`
        );
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            return data.results[0].urls.regular;
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error fetching image:", error);
        return null;
    }
}

// --- Game Management ---
const activeGames = {}; // In-memory store for active games

function generateGameId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// --- Create Multiplayer Game Route ---
app.post("/api/game/create", async (req, res) => {
    try {
        const { userId, wordLength, gameMode } = req.body;

        const gameId = generateGameId();
        const newGame = new Game({
            _id: gameId,
            players: [userId],
            wordLength,
            gameState: "waiting",
        });

        await newGame.save();

        activeGames[gameId] = {
            players: [userId],
            wordLength,
            guessedLetters: [],
            guessesLeft: 6,
            turn: userId, // Set the initial turn to the creator
            gameState: "waiting",
        };

        res.status(201).json({ gameId });
    } catch (error) {
        console.error("Error creating game:", error);
        res.status(500).send("Internal Server Error");
    }
});

// --- Join Multiplayer Game Route ---
app.post("/api/game/join", async (req, res) => {
    try {
        const { gameId, userId } = req.body;

        const game = await Game.findById(gameId);
        if (!game) {
            return res.status(404).send("Game not found");
        }

        if (game.gameState !== "waiting") {
            return res.status(400).send("Game is not joinable");
        }

        if (!game.players.includes(userId)) {
            game.players.push(userId);
            await game.save();
        }

        activeGames[gameId].players.push(userId);
        res.status(200).send("Joined game successfully");
    } catch (error) {
        console.error("Error joining game:", error);
        res.status(500).send("Internal Server Error");
    }
});

// --- Socket.IO ---
const connectedUsers = {}; // Keep track of connected users and their socket IDs

io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    // Handle user connection
    socket.on("user-connected", (userId) => {
        console.log("User connected:", userId);
        connectedUsers[userId] = socket.id;

        // Check for active games and rejoin
        for (const gameId in activeGames) {
            if (activeGames[gameId].players.includes(userId)) {
                socket.join(gameId);
                console.log(`User ${userId} rejoined game ${gameId}`);

                socket.emit("game-state-update", {
                    gameId: gameId,
                    gameState: activeGames[gameId].gameState,
                    guessedLetters: activeGames[gameId].guessedLetters,
                    displayedWord: activeGames[gameId].displayedWord,
                    guessesLeft: activeGames[gameId].guessesLeft,
                    isCorrectGuess: true,
                    turn: activeGames[gameId].turn,
                    gameOver: activeGames[gameId].gameState === "completed",
                    winner: activeGames[gameId].winner,
                });
            }
        }
    });

    // Handle joining a game
    socket.on("join-game", async ({ gameId, userId }) => {
        try {
            const game = await Game.findById(gameId);
            if (!game) {
                return socket.emit("game-error", "Game not found");
            }

            if (game.gameState !== "waiting") {
                return socket.emit("game-error", "Game is not in a joinable state");
            }

            if (!game.players.includes(userId)) {
                game.players.push(userId);
                await game.save();
            }

            socket.join(gameId);
            io.to(gameId).emit("user-joined", { userId, gameId });
        } catch (error) {
            console.error("Error joining game:", error);
            socket.emit("game-error", "Error joining game");
        }
    });

    // Handle starting a game
    socket.on("start-game", async ({ gameId }) => {
        try {
            const game = await Game.findById(gameId);
            if (!game) {
                return socket.emit("game-error", "Game not found");
            }

            if (game.gameState !== "waiting") {
                return socket.emit("game-error", "Game is not in a startable state");
            }

            activeGames[gameId] = activeGames[gameId] || {};
            activeGames[gameId].gameState = "in-progress";

            const wordData = await fetchWord(game.wordLength);
            activeGames[gameId].word = wordData.word.toLowerCase();
            activeGames[gameId].definition = wordData.definition;
            activeGames[gameId].displayedWord = Array(activeGames[gameId].word.length).fill("_").join("");
            activeGames[gameId].guessedLetters = [];
            activeGames[gameId].guessesLeft = 6;
            activeGames[gameId].players = game.players;
            activeGames[gameId].turn = game.players[0];

            game.gameState = "in-progress";
            game.word = activeGames[gameId].word;
            game.definition = activeGames[gameId].definition;
            await game.save();

            io.to(gameId).emit("game-started", {
                gameId,
                wordLength: activeGames[gameId].word.length,
                guessesLeft: activeGames[gameId].guessesLeft,
                firstPlayer: activeGames[gameId].turn,
                definition: activeGames[gameId].definition,
            });
        } catch (error) {
            console.error("Error starting game:", error);
            socket.emit("game-error", "Error starting the game");
        }
    });

    // Handle guesses
    socket.on("guess", async (data) => {
        console.log("Received guess:", data);
        const { userId, gameId, letter } = data;

        if (!activeGames[gameId] || !activeGames[gameId].players.includes(userId)) {
            console.error("Invalid game ID or user not in game");
            return;
        }

        if (activeGames[gameId].turn !== userId) {
            console.error("Not the user's turn");
            return;
        }

        if (activeGames[gameId].guessedLetters.includes(letter)) {
            console.log("Letter already guessed");
            return;
        }

        activeGames[gameId].guessedLetters.push(letter);

        let correctGuess = false;
        let newDisplayedWord = "";
        for (let i = 0; i < activeGames[gameId].word.length; i++) {
            if (activeGames[gameId].word[i] === letter) {
                newDisplayedWord += letter;
                correctGuess = true;
            } else {
                newDisplayedWord += activeGames[gameId].displayedWord[i];
            }
        }
        activeGames[gameId].displayedWord = newDisplayedWord;

        if (!correctGuess) {
            activeGames[gameId].guessesLeft--;
        }

        let gameOver = false;
        if (activeGames[gameId].guessesLeft === 0) {
            gameOver = true;
        } else if (activeGames[gameId].displayedWord === activeGames[gameId].word) {
            gameOver = true;
            activeGames[gameId].players.forEach((playerId) => {
                if (playerId === userId) {
                    updateUserScore(playerId, 10, 1);
                }
            });
        }

        if (!gameOver) {
            const currentPlayerIndex = activeGames[gameId].players.indexOf(userId);
            const nextPlayerIndex =
                (currentPlayerIndex + 1) % activeGames[gameId].players.length;
            activeGames[gameId].turn = activeGames[gameId].players[nextPlayerIndex];
        } else {
            activeGames[gameId].gameState = "completed";
            const game = await Game.findById(gameId);
            if (game) {
                game.gameState = "completed";
                await game.save();
            }
        }

        io.to(gameId).emit("game-state-update", {
            gameState: activeGames[gameId].gameState,
            guessedLetters: activeGames[gameId].guessedLetters,
            displayedWord: activeGames[gameId].displayedWord,
            guessesLeft: activeGames[gameId].guessesLeft,
            isCorrectGuess: correctGuess,
            turn: activeGames[gameId].turn,
            gameOver: gameOver,
            winner:
                gameOver && activeGames[gameId].displayedWord === activeGames[gameId].word
                    ? userId
                    : null,
        });

        if (gameOver) {
            setTimeout(() => {
                delete activeGames[gameId];
                console.log(`Game data for game ${gameId} cleared after delay.`);
            }, 60000);
        }

        socket.broadcast.emit("guess-broadcast", data);
    });

    // Handle score updates
    socket.on("update-score", async (data) => {
        // ... your existing update-score logic ...
    });

    // Handle disconnections
    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        for (const userId in connectedUsers) {
            if (connectedUsers[userId] === socket.id) {
                delete connectedUsers[userId];
                break;
            }
        }
    });
});

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});