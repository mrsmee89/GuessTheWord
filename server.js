require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Database ---
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  avatar: String,
  points: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  gameHistory: [{
    word: String,
    won: Boolean,
    timestamp: { type: Date, default: Date.now },
  }],
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

// Authentication Route
app.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    const payload = await verifyGoogleToken(credential);

    let user = await User.findOne({ googleId: payload.sub });
    if (!user) {
      user = new User({
        googleId: payload.sub,
        name: payload.name,
        email: payload.email,
        avatar: payload.picture,
      });
    } else {
      // Update user data if it has changed in Google account
      user.name = payload.name;
      user.email = payload.email;
      user.avatar = payload.picture;
    }
    await user.save();

    // Create a session or JWT token for the user here if needed

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

// Get User Data Route
app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findOne({ googleId: req.params.id });
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

// Update User Points and Level Route
app.post("/api/user/:id/update-score", async (req, res) => {
  try {
    const { points, level, word, won } = req.body;
    const user = await User.findOne({ googleId: req.params.id });
    if (!user) {
      return res.status(404).send("User not found");
    }

    user.points += points;
    user.level = Math.max(user.level, level); // Ensure level doesn't go down
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

// --- Word and Image Fetching ---

const wordApiUrl = "https://random-word-api.herokuapp.com/word?number=1";
const imageApiUrl = "https://api.unsplash.com/search/photos?query=";

async function fetchWord() {
  try {
    const response = await fetch(wordApiUrl);
    const data = await response.json();
    const definition = await fetchWordDefinition(data[0]);
    return { word: data[0], definition };
  } catch (error) {
    console.error("Error fetching word:", error);
    const fallbackWords = [
      { word: "example", definition: "A representative instance." },
    ];
    const randomIndex = Math.floor(Math.random() * fallbackWords.length);
    return fallbackWords[randomIndex];
  }
}

async function fetchWordDefinition(word) {
  try {
    // Placeholder for a real definition API call
    return "Definition not found";
  } catch (error) {
    console.error("Error fetching definition:", error);
    return "Definition not found";
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
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Handle user connection (you might want to associate the socket with a user here)
  socket.on("user-connected", (userId) => {
    console.log("User connected:", userId);
    // You can store the userId and socket.id in a map or database to keep track of connected users
  });

  socket.on("update-score", async (data) => {
    try {
      const user = await User.findOne({ googleId: data.userId });
      if (!user) {
        console.error(`User not found: ${data.userId}`);
        return;
      }

      user.points += data.points;
      user.level = Math.max(user.level, data.level);

      // Add to game history if the game was played (not skipped)
      if (data.word) {
        user.gameHistory.push({
          word: data.word,
          won: data.won,
          timestamp: new Date(),
        });
      }

      await user.save();

      // Emit to the specific user who played the game
      socket.emit("score-updated", {
        userId: user.googleId,
        points: user.points,
        level: user.level,
      });

      // Optionally, broadcast to other users if you want a real-time leaderboard
      // io.emit('score-updated', { userId: user.googleId, points: user.points, level: user.level });
    } catch (err) {
      console.error("Error updating user data:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // You might want to handle user disconnection here (e.g., remove them from a connected users list)
  });
});

// --- Serve Static Files ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});