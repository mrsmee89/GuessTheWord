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
const User = require("./models/User"); // Import the User model
const Game = require("./models/Game");

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
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",
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

        if (!payload) {
            throw new Error("Invalid token");
        }

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
                gameHistory: []
            });
        }

        // Update existing user data
        user.name = payload.name;
        user.email = payload.email;
        user.avatar = payload.picture;

        await user.save();

        // Create JWT token with all necessary user data
        const token = jwt.sign({
            userId: user.googleId,
            name: user.name,
            email: user.email,
            picture: user.avatar
        }, process.env.JWT_SECRET, {
            expiresIn: "7d"
        });

        // Set session
        req.session.userId = user.googleId;
        
        // Set JWT cookie
        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        // Send user data back to client
        res.json({
            id: user.googleId,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            points: user.points,
            level: user.level
        });

    } catch (error) {
        console.error("Authentication error:", error);
        res.status(401).send(error.message);
    }
});

// Add session check middleware
const checkAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token && !req.session.userId) {
        return res.status(401).send("Unauthorized");
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (req.session.userId) {
            next();
        } else {
            res.status(401).send("Invalid token");
        }
    }
};

// Apply auth middleware to protected routes
app.use(["/api/user", "/api/game"], checkAuth);

// --- Configuration Route ---
app.get("/api/config", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return res.status(500).json({ error: "Google Client ID not configured" });
    }
    res.json({ googleClientId: clientId });
});

// --- Protected Route Example (with JWT verification) ---
app.get("/api/protected", (req, res) => {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).send("Unauthorized: No token provided");
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // You can now fetch the user from the database using decoded.userId if needed
        // Example:
        // const user = await User.findOne({ googleId: decoded.userId });
        // req.user = user; // Attach the user to the request object

        res.json({
            message: "This is a protected route",
            userId: decoded.userId
        });
    } catch (error) {
        console.error("JWT verification error:", error);
        res.status(401).send("Unauthorized: Invalid token");
    }
});

// --- User Data Routes ---

// GET /api/user/:userId - Get user data by Google ID
app.get("/api/user/:userId", async (req, res) => {
    try {
        const token = req.cookies.token; // Get token from cookie
        if (!token) {
            return res.status(401).send("Unauthorized: No token provided");
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify the token

        // Check if the user making the request is the same as the one being requested
        if (decoded.userId !== req.params.userId) {
            return res.status(403).send("Forbidden: You can only access your own data");
        }

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
        if (error.name === "JsonWebTokenError") {
            return res.status(401).send("Unauthorized: Invalid token");
        }
        res.status(500).send("Internal Server Error");
    }
});

// POST /api/user - Create a new user
app.post("/api/user", async (req, res) => {
    try {
        const { googleId, name, email, avatar } = req.body;
        let user = await User.findOne({ googleId });
        if (user) {
            return res.status(400).json({
                message: "User already exists"
            });
        }

        user = new User({
            googleId,
            name,
            email,
            avatar,
            gameHistory: [], // Initialize gameHistory
        });

        await user.save();
        res.status(201).json(user);
    } catch (error) {
        console.error("Error creating user:", error);
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
        user.gameHistory.push({
            word,
            won,
            timestamp: new Date()
        });

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
        res.json({
            word,
            definition
        });
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
            turn: userId,
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

    socket.on("user-connected", (userId) => {
        console.log("User connected:", userId);
        connectedUsers[userId] = socket.id; // Store socket ID: This creates a map of userId: socket id

        // Check if the user is in an active game
        for (const gameId in activeGames) {
            if (activeGames[gameId].players.includes(userId)) {
                // Rejoin the user to the game room
                socket.join(gameId);
                console.log(`User ${userId} rejoined game ${gameId}`);

                // Optionally, emit the current game state to the rejoined user
                socket.emit("game-state-update", {
                    gameState: activeGames[gameId].gameState,
                    guessedLetters: activeGames[gameId].guessedLetters,
                    displayedWord: activeGames[gameId].displayedWord,
                    guessesLeft: activeGames[gameId].guessesLeft,
                    isCorrectGuess: true, // You might want to adjust this based on your game logic
                    turn: activeGames[gameId].turn,
                    gameOver: activeGames[gameId].gameState === "completed",
                    winner: activeGames[gameId].winner,
                });
            }
        }
    });

    socket.on("join-game", async ({ gameId, userId }) => {
        try {
            // Check if the game exists and is active
            const game = await Game.findById(gameId);
            if (!game) {
                return socket.emit("game-error", "Game not found");
            }

            // Check if the game is in the 'waiting' state
            if (game.gameState !== "waiting") {
                return socket.emit("game-error", "Game is not in a joinable state");
            }

            // Check if the user is already in the game
            if (!game.players.includes(userId)) {
                game.players.push(userId);
                await game.save();
            }

            // Add the user to the Socket.IO room for the game
            socket.join(gameId);

            // Emit an event to all users in the game that a new user has joined
            io.to(gameId).emit("user-joined", { userId, gameId });
        } catch (error) {
            console.error("Error joining game:", error);
            socket.emit("game-error", "Error joining game");
        }
    });

    socket.on("start-game", async ({ gameId }) => {
        try {
            // Find the game in the database and check if it exists
            const game = await Game.findById(gameId);
            if (!game) {
                return socket.emit("game-error", "Game not found");
            }

            // Check if the game is in the 'waiting' state
            if (game.gameState !== "waiting") {
                return socket.emit("game-error", "Game is not in a startable state");
            }

            // Initialize the game data
            activeGames[gameId] = activeGames[gameId] || {};
            activeGames[gameId].gameState = "in-progress";

            // Fetch a new word for the game
            const wordData = await fetchWord(game.wordLength);
            activeGames[gameId].word = wordData.word.toLowerCase();
            activeGames[gameId].definition = wordData.definition;
            activeGames[gameId].displayedWord = Array(
                activeGames[gameId].word.length
            )
                .fill("_")
                .join("");
            activeGames[gameId].guessedLetters = [];
            activeGames[gameId].guessesLeft = 6;
            activeGames[gameId].players = game.players; // Ensure players are set
            activeGames[gameId].turn = game.players[0]; // Set the first player's turn

            // Update the game state in the database
            game.gameState = "in-progress";
            game.word = activeGames[gameId].word;
            game.definition = activeGames[gameId].definition;
            game.save();

            // Emit to all users in the game that the game has started
            io.to(gameId).emit("game-started", {
                gameId,
                wordLength: activeGames[gameId].word.length,
                guessesLeft: activeGames[gameId].guessesLeft,
                firstPlayer: activeGames[gameId].turn,
                definition: activeGames[gameId].definition
            });
        } catch (error) {
            console.error("Error starting game:", error);
            socket.emit("game-error", "Error starting the game");
        }
    });

    socket.on("guess", async (data) => {
        console.log("Received guess:", data);
        const { userId, gameId, letter } = data;

        // Validate the game id and user
        if (!activeGames[gameId] || !activeGames[gameId].players.includes(userId)) {
            console.error("Invalid game ID or user not in game");
            return;
        }

        // Ensure it's the current player's turn
        if (activeGames[gameId].turn !== userId) {
            console.error("Not the user's turn");
            return;
        }

        // Check if the letter has already been guessed
        if (activeGames[gameId].guessedLetters.includes(letter)) {
            console.log("Letter already guessed");
            return;
        }

        activeGames[gameId].guessedLetters.push(letter);

        // Check if the guess is correct
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

        // Update guesses left if the guess is incorrect
        if (!correctGuess) {
            activeGames[gameId].guessesLeft--;
        }

        // Check for game over condition
        let gameOver = false;
        if (activeGames[gameId].guessesLeft === 0) {
            // Game lost
            gameOver = true;
        } else if (activeGames[gameId].displayedWord === activeGames[gameId].word) {
            // Game won
            gameOver = true;
            activeGames[gameId].players.forEach((playerId) => {
                if (playerId === userId) {
                    // Increment points only for the user who won the game
                    updateUserScore(playerId, 10, 1); // Assuming 10 points for a win, increase level by 1
                }
            });
        }

        // Update the turn to the next player if the game is not over
        if (!gameOver) {
            const currentPlayerIndex =
                activeGames[gameId].players.indexOf(userId);
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

        // Emit the updated game state to all players in the game
        io.to(gameId).emit("game-state-update", {
            gameState: activeGames[gameId].gameState,
            guessedLetters: activeGames[gameId].guessedLetters,
            displayedWord: activeGames[gameId].displayedWord,
            guessesLeft: activeGames[gameId].guessesLeft,
            isCorrectGuess: correctGuess,
            turn: activeGames[gameId].turn,
            gameOver: gameOver,
            winner: gameOver && activeGames[gameId].displayedWord === activeGames[gameId].word ?
                userId : null,
        });

        // If the game is over, clean up the game data after a delay
        if (gameOver) {
            setTimeout(() => {
                delete activeGames[gameId];
                console.log(`Game data for game ${gameId} cleared after delay.`);
            }, 60000); // 60 seconds delay
        }
        // Broadcast the guess to all other connected clients
        socket.broadcast.emit("guess-broadcast", data);
    });

    socket.on("update-score", async (data) => {
        try {
            const user = await User.findOne({
                googleId: data.userId
            });
            if (!user) {
                console.error(`User not found: ${data.userId}`);
                return;
            }

            user.points += data.points;
            user.level = Math.max(user.level, data.level);
            if (data.word) {
                user.gameHistory.push({
                    word: data.word,
                    won: data.won,
                    timestamp: new Date(),
                });
            }
            await user.save();

            // Emit to the specific user who made the update
            const userSocketId = connectedUsers[data.userId];
            if (userSocketId) {
                io.to(userSocketId).emit("score-updated", {
                    userId: user.googleId,
                    points: user.points,
                    level: user.level,
                });
            }

            // Broadcast to all other users for real-time updates
            socket.broadcast.emit("score-updated", {
                userId: user.googleId,
                points: user.points,
                level: user.level,
            });
        } catch (err) {
            console.error("Error updating user data:", err);
        }
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        // Remove user from connectedUsers list
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

// Add logout route
app.post('/auth/logout', (req, res) => {
    // Clear session
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Logout failed' });
        }
        
        // Clear cookie
        res.clearCookie('token');
        res.status(200).json({ message: 'Logged out successfully' });
    });
});

// Update session check endpoint
app.get('/api/check-session', (req, res) => {
    try {
        // Get token from cookie or Authorization header
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        console.log("Checking session with token:", token);
        
        if (!token) {
            console.log("No token found");
            return res.status(401).json({ 
                isAuthenticated: false,
                message: "No token provided"
            });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Set or refresh the session
        req.session.userId = decoded.userId;
        
        // Refresh the cookie
        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
        
        res.json({
            isAuthenticated: true,
            userId: decoded.userId,
            name: decoded.name,
            email: decoded.email,
            picture: decoded.picture
        });
    } catch (error) {
        console.error("Session verification error:", error);
        res.clearCookie('token', { path: '/' });
        res.status(401).json({ 
            isAuthenticated: false,
            message: error.message 
        });
    }
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});