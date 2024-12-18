require('dotenv').config({ path: '.env' }); 
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
// const { OAuth2Client } = require('google-auth-library'); // For JWT verification
const fs = require('fs'); // If you still need to use gameLogs.json
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true, index: true }, // Added index
    name: String,
    email: String,
    avatar: String,
    points: { type: Number, default: 0 },
    level: { type: Number, default: 1 }
});

const User = mongoose.model('User', userSchema);

// Google OAuth2 Client
// const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve from 'public'

// Authentication Route
// app.post('/auth/google', async (req, res) => {
//     try {
//         const credential = req.body.credential;

//         // Verify the JWT
//         const ticket = await client.verifyIdToken({
//             idToken: credential,
//             audience: process.env.GOOGLE_CLIENT_ID,
//         });
//         const decoded = ticket.getPayload();

//         let user = await User.findOne({ googleId: decoded.sub });
//         if (!user) {
//             user = new User({
//                 googleId: decoded.sub,
//                 name: decoded.name,
//                 email: decoded.email,
//                 avatar: decoded.picture
//             });
//         }
//         await user.save();

//         res.json({ user });
//     } catch (error) {
//         console.error('Authentication error:', error);
//         res.status(500).send('Authentication failed');
//     }
// });

// Socket.IO
io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('gameOver', async (data) => {
        try {
            const user = await User.findOne({ name: data.user });
            if (user) {
                user.points = data.points;
                user.level = data.level;
                await user.save();
                console.log(`User ${data.user} data updated after game over.`);
            } else {
                console.error(`User not found: ${data.user}`);
            }
            io.emit('gameLogUpdate', `${data.user} lost the game. The word was "${data.word}".`);
        } catch (err) {
            console.error('Error updating user data:', err);
        }
    });

    socket.on('gameWon', async (data) => {
        try {
            const user = await User.findOne({ name: data.user });
            if (user) {
                user.points = data.points;
                user.level = data.level;
                await user.save();
                console.log(`User ${data.user} data updated after winning.`);
            } else {
                console.error(`User not found: ${data.user}`);
            }
            io.emit('gameLogUpdate', `${data.user} won the game! Word: ${data.word}, Points: ${data.points}, Level: ${data.level}`);
        } catch (err) {
            console.error('Error updating user data:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});