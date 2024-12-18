require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const path = require("path");
const {
    OAuth2Client
} = require("google-auth-library");
const session = require("express-session");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

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
app.use(cookieParser());

// --- Session Configuration ---
app.use(
    session({
        secret: process.env.SESSION_SECRET, // Set this in your .env file!
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: process.env.NODE_ENV === "production", // Use secure cookies in production (HTTPS)
            maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week (adjust as needed)
            httpOnly: true,
        },
    })
);

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
        if (!user) {
            user = new User({
                googleId: payload.sub,
                name: payload.name,
                email: payload.email,
                avatar: payload.picture,
                gameHistory: []
            });
            console.log("New user created");
        } else {
            // Update user data if it has changed in the Google account
            user.name = payload.name;
            user.email = payload.email;
            user.avatar = payload.picture;
            console.log("User info updated");
        }
        await user.save();

        // Create JWT token
        const token = jwt.sign({
            userId: user.googleId
        }, process.env.JWT_SECRET, {
            expiresIn: "7d", // Token expires in 7 days (adjust as needed)
        });

        // Set JWT token in HTTP-only cookie
        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production", // Secure in production
            maxAge: 1000 * 60 * 60 * 24 * 7, // Same as token expiration
        });

        res.json({
            id: user.googleId,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            points: user.points,
            level: user.level,
            gameHistory: user.gameHistory
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

// --- Protected Route Example (with JWT verification) ---
app.get("/api/protected", (req, res) => {
    const token = req.cookies.token; // Get token from cookie

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
        // Check for JWT token in Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).send("Unauthorized: Bearer token required");
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify the token

        // Check if the user making the request is the same as the one being requested
        if (decoded.userId !== req.params.userId) {
            return res.status(403).send("Forbidden: You can only access your own data");
        }

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
        if (error.name === "JsonWebTokenError") {
            return res.status(401).send("Unauthorized: Invalid token");
        }
        res.status(500).send("Internal Server Error");
    }
});

// POST /api/user - Create a new user
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

// POST /api/user/:userId/update-score - Update user score and game history
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
        // Emit the guess to all sockets except the one that sent the guess
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

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});