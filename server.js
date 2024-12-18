require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// MongoDB Schema for User
const userSchema = new mongoose.Schema({
    googleId: String,
    name: String,
    email: String,
    avatar: String,
    points: { type: Number, default: 0 },
    level: { type: Number, default: 1 }
});

const User = mongoose.model('User', userSchema);

// Middleware to parse JSON requests
app.use(express.json());

// Serve static files
app.use(express.static(__dirname));

// Authentication Route (Simplified Example)
app.post('/auth/google', async (req, res) => {
    try {
        const credential = req.body.credential;
        const decoded = jwt.decode(credential); // In production, verify this token!

        let user = await User.findOne({ googleId: decoded.sub });
        if (!user) {
            user = new User({
                googleId: decoded.sub,
                name: decoded.name,
                email: decoded.email,
                avatar: decoded.picture
            });
        }
        await user.save();

        res.json({ user });
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).send('Authentication failed');
    }
});

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log('New client connected');

    // Handle game over event
    socket.on('gameOver', async (data) => {
        try {
            const user = await User.findOne({ name: data.user });
            if (user) {
                user.points = data.points;
                user.level = data.level;
                await user.save();
            }
        } catch (err) {
            console.error('Error updating user data:', err);
        }
        io.emit('gameLogUpdate', `${data.user} lost the game. The word was "${data.word}".`);
    });

    // Handle game won event
    socket.on('gameWon', async (data) => {
        try {
            const user = await User.findOne({ name: data.user });
            if (user) {
                user.points = data.points;
                user.level = data.level;
                await user.save();
            }
        } catch (err) {
            console.error('Error updating user data:', err);
        }
        io.emit('gameLogUpdate', `${data.user} won the game! Word: ${data.word}, Points: ${data.points}, Level: ${data.level}`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});