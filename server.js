require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const path = require("path");
const {
    OAuth2Client
} = require("google-auth-library");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Database ---
mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connection error:", err));

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
    }, ],
});

const User = mongoose.model("User", userSchema);

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

// --- API Routes ---

// --- Authentication Route ---
app.post("/auth/google", async (req, res) => {
    try {
        const {
            credential
        } = req.body;
        const payload = await verifyGoogleToken(credential);

        let user = await User.findOne({
            googleId: payload.sub
        });
        console.log(user);
        if (!user) {
            user = new User({
                googleId: payload.sub,
                name: payload.name,
                email: payload.email,
                avatar: payload.picture,
            });
            console.log("new user created");
        } else {
            // Update user data if it has changed in the Google account
            user.name = payload.name;
            user.email = payload.email;
            user.avatar = payload.picture;
            console.log("user info updated");
        }
        await user.save();

        // Note: You might want to create a session or JWT token here

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
        res.status(401).send("Authentication failed");
    }
});

// --- Configuration Route ---
app.get("/api/config", (req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID,
    });
});

// --- User Data Routes ---
app.get("/api/user/:userId", async (req, res) => {
    try {
        const user = await User.findOne({
            googleId: req.params.userId
        });
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

app.post("/api/user", async (req, res) => {
    try {
        const {
            googleId,
            name,
            email,
            avatar
        } = req.body;
        let user = await User.findOne({
            googleId
        });
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
        });

        await user.save();
        res.status(201).json(user);
    } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/api/user/:userId/update-score", async (req, res) => {
    try {
        const {
            points,
            level,
            word,
            won
        } = req.body;
        const user = await User.findOne({
            googleId: req.params.userId
        });
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

// --- Word and Image Fetching (Not directly related to user data) ---

const wordApiUrl = "https://random-word-api.herokuapp.com/word?number=1";
const imageApiUrl = "https://api.unsplash.com/search/photos?query=";
const definitionApiUrl =
    "https://api.dictionaryapi.dev/api/v2/entries/en/";

async function fetchWord() {
    try {
        const response = await fetch(wordApiUrl);
        const data = await response.json();
        const definition = await fetchWordDefinition(data[0]);
        return {
            word: data[0],
            definition
        };
    } catch (error) {
        console.error("Error fetching word:", error);
        const fallbackWords = [{
            word: "example",
            definition: "A representative instance."
        }, ];
        const randomIndex = Math.floor(Math.random() * fallbackWords.length);
        return fallbackWords[randomIndex];
    }
}

async function fetchWordDefinition(word) {
    try {
        const response = await fetch(`${definitionApiUrl}${word}`);
        const data = await response.json();

        if (data[0] ?.meanings[0] ?.definitions[0] ?.definition) {
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

// --- Socket.IO ---
const connectedUsers = {}; // Keep track of connected users

io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    socket.on("user-connected", (userId) => {
        console.log("User connected:", userId);
        connectedUsers[userId] = socket.id; // Store socket ID
    });

    socket.on("guess", (data) => {
        console.log("guess data received", data)
        socket.broadcast.emit("guess-broadcast", data); // Broadcast to all except sender
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

            // Optionally, broadcast to all other users for real-time updates
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

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});