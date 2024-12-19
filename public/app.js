document.addEventListener("DOMContentLoaded", async () => {
    // --- DOM Elements ---
    const imageContainer = document.getElementById("image-container");
    const wordContainer = document.getElementById("word-container");
    const guessesLeftSpan = document.getElementById("guesses-left");
    const letterInput = document.getElementById("letter-input");
    const guessButton = document.getElementById("guess-button");
    const messageContainer = document.getElementById("message-container");
    const newGameButton = document.getElementById("new-game-button");
    const gameLog = document.getElementById("game-log");
    const logList = document.getElementById("log-list");
    const soundToggleButton = document.getElementById("sound-toggle-button");
    const imageHintButton = document.getElementById("image-hint-button");
    const definitionHintButton = document.getElementById("definition-hint-button");
    const letterHintButton = document.getElementById("letter-hint-button");
    const extraGuessButton = document.getElementById("extra-guess-button");
    const skipWordButton = document.getElementById("skip-word-button");
    const fiftyFiftyButton = document.getElementById("fifty-fifty-button");
    const userAvatar = document.getElementById("user-avatar");
    const userName = document.getElementById("user-name");
    const userPointsSpan = document.getElementById("user-points");
    const gameLevelSpan = document.getElementById("game-level");
    const leaderboardButton = document.getElementById("leaderboard-button");
    const loadingScreen = document.getElementById("loading-screen");
    const container = document.querySelector(".container");
    const signInContainer = document.getElementById("buttonDiv");
    const playAsGuestButton = document.getElementById("play-as-guest-button");
    const settingsContainer = document.getElementById("settings-container");
    const wordLengthSelect = document.getElementById("word-length");
    const gameModeSelect = document.getElementById("game-mode");
    const shareButton = document.getElementById("share-button");
    const logoutButton = document.getElementById("logout-button");
    const authButtons = document.getElementById("auth-buttons");

    // --- Constants and Variables ---
    const wordApiUrl = "/api/word"; // Using server-side route
    const imageApiUrl = "https://api.unsplash.com/search/photos?query=";
    const definitionApiUrl =
        "https://api.dictionaryapi.dev/api/v2/entries/en/";

    const imageApiKey = "YOUR-UNSPLASH-API-KEY"; // **REPLACE WITH YOUR UNSPLASH API KEY**
    async function fetchConfig() {
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        return config;
    }

    const config = await fetchConfig();

    let selectedWord = "";
    let selectedWordDefinition = "";
    let displayedWord = "";
    let guessedLetters = [];
    let guessesLeft = 6;
    let userProfile = null; // Will be null for guest users
    let gameLevel = 1;
    let userPoints = 0;
    let soundEnabled = true;
    let gameInProgress = false;
    let isGuestUser = false; // Flag to indicate guest user
    let gameId = localStorage.getItem("currentGameId") || null; // Retrieve game ID from localStorage if available

    // --- Socket.IO ---
    const socket = io();

    socket.on("connect", () => {
        console.log("Connected to socket server");
        if (userProfile && !isGuestUser) {
            socket.emit("user-connected", userProfile.id);
        }
    });

    socket.on("gameLogUpdate", (logEntry) => {
        addLogEntry(logEntry);
    });

    socket.on("score-updated", (data) => {
        if (userProfile && data.userId === userProfile.id) {
            userPoints = data.points;
            gameLevel = data.level;
            updateDisplay();
        }
    });

    // Handle incoming guess broadcasts
    socket.on("guess-broadcast", (data) => {
        // if user is logged in with google, display the guess broadcast in the game log
        if (!isGuestUser && data.userId !== userProfile.id) {
            const message = `${data.userName} guessed: ${data.letter}`;
            addLogEntry(message);
        }
    });

    // Handle game state updates
    socket.on("game-state-update", (data) => {
        if (data.gameId === localStorage.getItem("currentGameId")) {
            updateGameState(data);
            // Store current game state
            localStorage.setItem("currentGameState", JSON.stringify(data));
        }
    });

    // --- Game Initialization ---
    async function initializeGame() {
        try {
            showLoadingScreen();
            gameInProgress = false;
            enableGameControls(false); // Disable while loading

            // Fetch user data if signed in, before fetching the word
            if (!isGuestUser && userProfile) {
                await fetchUserData(userProfile.id);
            }

            const wordLength = wordLengthSelect.value;
            const wordData = await fetchWord(wordLength); // Pass word length to fetchWord
            selectedWord = wordData.word.toLowerCase();
            selectedWordDefinition = wordData.definition;
            console.log("Selected word:", selectedWord);

            await fetchImageForWord(selectedWord);
            initializeGameState();
            updateDisplay();
            addLogEntry(
                isGuestUser
                    ? `Guest started a new game. Level: ${gameLevel}`
                    : `${userProfile.name} started a new game. Level: ${gameLevel}`
            );
            gameInProgress = true;
        } catch (error) {
            console.error("Error initializing game:", error);
            messageContainer.textContent = "Error: Could not initialize the game.";
        } finally {
            hideLoadingScreen();
            enableGameControls(true); // Re-enable controls
        }
    }

    // --- Show/Hide Loading Screen ---
    function showLoadingScreen() {
        container.style.display = "none";
        loadingScreen.style.display = "flex";
    }

    function hideLoadingScreen() {
        loadingScreen.style.display = "none";
        container.style.display = "block";
    }

    // --- Fetching Word and Definition ---
    async function fetchWord(wordLength = 5) {
        try {
            const response = await fetch(`${wordApiUrl}?length=${wordLength}`);
            const wordData = await response.json();
            return wordData;
        } catch (error) {
            console.error("Error fetching word:", error);
            const fallbackWords = [
                { word: "example", definition: "A representative instance." },
                // Add more fallback words
            ];
            const randomIndex = Math.floor(Math.random() * fallbackWords.length);
            return fallbackWords[randomIndex];
        }
    }

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

    // --- Fetching Images ---
    async function fetchImageForWord(word) {
        try {
            const response = await fetch(
                `${imageApiUrl}${word}&client_id=${imageApiKey}`
            );
            const data = await response.json();
            if (data.results && data.results.length > 0) {
                const imageUrl = data.results[0].urls.regular;
                imageContainer.innerHTML = `<img src="${imageUrl}" alt="Word Image" class="fade-in">`;
            } else {
                imageContainer.innerHTML = "<p>No image found</p>";
            }
        } catch (error) {
            console.error("Error fetching image:", error);
            imageContainer.innerHTML = "<p>Error loading image</p>";
        }
    }

    // --- Game State ---
    function initializeGameState() {
        displayedWord = Array(selectedWord.length).fill("_").join("");
        guessedLetters = [];
        guessesLeft = 6;
        // Reset power-ups or other game state variables as needed
        enableGameControls(true);
        resetAnimations();
    }

    function updateDisplay() {
        wordContainer.textContent = displayedWord.split("").join(" ");
        guessesLeftSpan.textContent = guessesLeft;
        messageContainer.textContent = "";
        letterInput.value = "";
        gameLevelSpan.textContent = `Level ${gameLevel}`;
        userPointsSpan.textContent = `${userPoints} Points`;
    }

    // --- Input Validation ---
    function isValidLetter(letter) {
        return /^[a-z]$/.test(letter);
    }

    // --- Guess Handling ---
    function checkGuess() {
        const letter = letterInput.value.trim().toLowerCase();
        letterInput.value = "";

        if (!gameInProgress) {
            messageContainer.textContent =
                "Game is not in progress. Start a new game to play.";
            return;
        }

        if (!isValidLetter(letter)) {
            messageContainer.textContent =
                "Invalid input. Please enter a single letter.";
            return;
        }

        if (guessedLetters.includes(letter)) {
            messageContainer.textContent = "You already guessed that letter.";
            return;
        }

        guessedLetters.push(letter);

        if (selectedWord.includes(letter)) {
            updateDisplayedWord(letter);
            messageContainer.textContent = "Correct guess!";
            animateCorrectGuess();
        } else {
            guessesLeft--;
            messageContainer.textContent = "Incorrect guess.";
            animateIncorrectGuess();
        }

        updateDisplay();
        checkGameStatus();

        // Broadcast the guess to other users
        if (gameInProgress && !isGuestUser) {
            socket.emit("guess", {
                userId: userProfile.id,
                userName: userProfile.name,
                letter: letter,
                gameId: gameId,
            });
        }
    }

    function updateDisplayedWord(letter) {
        let newDisplayedWord = "";
        for (let i = 0; i < selectedWord.length; i++) {
            if (selectedWord[i] === letter) {
                newDisplayedWord += letter;
            } else {
                newDisplayedWord += displayedWord[i];
            }
        }
        displayedWord = newDisplayedWord;
    }

    // --- Game Status ---
    function checkGameStatus() {
        if (guessesLeft === 0) {
            gameLost();
        } else if (displayedWord === selectedWord) {
            gameWon();
        }
    }

    function gameWon() {
        messageContainer.textContent = `You won! The word was ${selectedWord}.`;
        addLogEntry(
            isGuestUser
                ? `Guest won the game! Word: ${selectedWord}, Level: ${gameLevel}`
                : `${userProfile.name} won the game! Word: ${selectedWord}, Points: ${userPoints}, Level: ${gameLevel}`
        );
        if (!isGuestUser) {
            userPoints += 10;
            gameLevel++;
            // Update user data on the server when the game is won
            updateUserScore(userProfile.id, 10, gameLevel, selectedWord, true);
        }

        gameInProgress = false;
        endGame();
    }

    function gameLost() {
        messageContainer.textContent = `You lost! The word was ${selectedWord}.`;
        addLogEntry(
            isGuestUser
                ? `Guest lost the game. The word was "${selectedWord}".`
                : `${userProfile.name} lost the game. The word was "${selectedWord}".`
        );
        gameInProgress = false;
        endGame();

        if (userProfile && !isGuestUser) {
            // Update user data on the server when the game is lost
            updateUserScore(userProfile.id, 0, gameLevel, selectedWord, false);
        }
    }

    // --- Game End ---
    function endGame() {
        enableGameControls(false);
        updateDisplay();
        // Re-enable the "Play as Guest" button
        if (isGuestUser) {
            playAsGuestButton.style.display = "inline-block";
        }
    }

    function enableGameControls(enable) {
        letterInput.disabled = !enable;
        guessButton.disabled = !enable;
        imageHintButton.disabled = !enable;
        definitionHintButton.disabled = !enable;
        letterHintButton.disabled = !enable;
        extraGuessButton.disabled = !enable;
        skipWordButton.disabled = !enable;
        fiftyFiftyButton.disabled = !enable;
    }

    // --- Animations ---
    function animateCorrectGuess() {
        gsap.to(wordContainer, {
            duration: 0.5,
            scale: 1.2,
            color: "green",
            ease: "elastic.out(1, 0.3)",
            yoyo: true,
            repeat: 1,
            onComplete: () => {
                gsap.set(wordContainer, { clearProps: "all" });
            },
        });
    }

    function animateIncorrectGuess() {
        gsap.to(guessesLeftSpan, {
            duration: 0.2,
            x: "+=10",
            repeat: 5,
            yoyo: true,
            ease: "power1.out",
            onComplete: () => {
                gsap.set(guessesLeftSpan, { clearProps: "all" });
            },
        });
    }

    function resetAnimations() {
        gsap.set([wordContainer, guessesLeftSpan], { clearProps: "all" });
    }

    // --- Hints ---
    function showImageHint() {
        imageContainer.classList.remove("fade-in");
        imageContainer.classList.add("blur");
        setTimeout(() => {
            imageContainer.classList.remove("blur");
        }, 5000);
    }

    function showDefinitionHint() {
        messageContainer.textContent = `Definition: ${selectedWordDefinition}`;
    }

    function showLetterHint() {
        let unrevealedIndices = [];
        for (let i = 0; i < selectedWord.length; i++) {
            if (!guessedLetters.includes(selectedWord[i])) {
                unrevealedIndices.push(i);
            }
        }
        if (unrevealedIndices.length > 0) {
            const randomIndex =
                unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)];
            const letterToReveal = selectedWord[randomIndex];
            updateDisplayedWord(letterToReveal);
            guessedLetters.push(letterToReveal);
            updateDisplay();
        }
    }

    // --- Power-ups ---
    function useExtraGuess() {
        if (guessesLeft < 10) {
            guessesLeft++;
            updateDisplay();
            messageContainer.textContent = "You got an extra guess!";
        } else {
            messageContainer.textContent =
                "You have reached the maximum number of guesses!";
        }
    }

    function useSkipWord() {
        initializeGame();
        messageContainer.textContent = "Word skipped!";
    }

    function useFiftyFifty() {
        let incorrectLetters = [];
        for (let charCode = 97; charCode <= 122; charCode++) {
            let letter = String.fromCharCode(charCode);
            if (!selectedWord.includes(letter) && !guessedLetters.includes(letter)) {
                incorrectLetters.push(letter);
            }
        }
        incorrectLetters.sort(() => 0.5 - Math.random());
        let lettersToRemove = incorrectLetters.slice(
            0,
            Math.floor(incorrectLetters.length / 2)
        );
        for (let letter of lettersToRemove) {
            guessedLetters.push(letter);
        }
        messageContainer.textContent = "50/50 used! Some incorrect letters removed.";
    }

    // --- Utility Functions ---
    function addLogEntry(entry) {
        const newLogItem = document.createElement("li");
        newLogItem.textContent = entry;
        logList.prepend(newLogItem);

        if (logList.children.length > 10) {
            logList.removeChild(logList.lastChild);
        }
    }

    function toggleSound() {
        soundEnabled = !soundEnabled;
        soundToggleButton.textContent = soundEnabled ? "Sound: ON" : "Sound: OFF";
    }

    // --- Google Sign-In, Guest Mode, and User Management ---
    async function initializeGoogleSignIn() {
        try {
            // Wait for Google API to load
            await new Promise((resolve, reject) => {
                if (typeof google !== 'undefined') {
                    resolve();
                } else {
                    const checkGoogle = setInterval(() => {
                        if (typeof google !== 'undefined') {
                            clearInterval(checkGoogle);
                            resolve();
                        }
                    }, 100);
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        clearInterval(checkGoogle);
                        reject(new Error('Google API failed to load'));
                    }, 5000);
                }
            });

            const configResponse = await fetch('/api/config');
            if (!configResponse.ok) {
                throw new Error('Failed to fetch config data');
            }
            const config = await configResponse.json();

            google.accounts.id.initialize({
                client_id: config.googleClientId,
                callback: handleCredentialResponse,
            });
            google.accounts.id.renderButton(
                document.getElementById("buttonDiv"), {
                    theme: "outline",
                    size: "large",
                    type: "standard",
                    shape: "pill",
                }
            );
            google.accounts.id.prompt();

            // Show/hide appropriate buttons based on session state
            const token = getCookie("token");
            authButtons.style.display = "flex"; // Ensure auth container is shown
            if (!token) {
                signInContainer.style.display = "block";
                playAsGuestButton.style.display = "block";
                logoutButton.style.display = "none";
                hideLoadingScreen(); // Hide loading screen if no token
            } else {
                await checkExistingSession();
            }

        } catch (error) {
            console.error("Error initializing Google Sign-In:", error);
            messageContainer.textContent = "Google Sign-In unavailable. You can play as a guest.";
            // Show guest button
            authButtons.style.display = "flex"; // Ensure auth container is shown
            signInContainer.style.display = "none";
            playAsGuestButton.style.display = "block";
            hideLoadingScreen(); // Hide loading screen if error occurs
        }
    }

    async function handleCredentialResponse(response) {
        try {
            // Send the credential to your server
            const serverResponse = await fetch("/auth/google", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    credential: response.credential
                })
            });

            if (!serverResponse.ok) {
                throw new Error("Server authentication failed");
            }

            const userData = await serverResponse.json();

            // Update user profile
            updateUserProfile(userData);

            // Fetch user data
            await fetchUserData(userProfile.id);

            // Start game
            initializeGame();
        } catch (error) {
            console.error("Error during Google Sign-In:", error);
            messageContainer.textContent = "Error: Could not sign in with Google.";
            initializeGuestUser();
        }
    }

    async function initializeGuestUser() {
        isGuestUser = true;
        userProfile = null; // No user profile for guests
        userName.textContent = "Guest";
        userAvatar.style.display = "none";
        signInContainer.style.display = "none";
        playAsGuestButton.style.display = "none"; // Hide guest button
        logoutButton.style.display = "none";
        authButtons.style.display = "none";

        // Initialize the game for the guest user
        initializeGame();
    }

    // --- Helper Functions for Authentication and Authorization ---

    function parseJwt(token) {
        const base64Url = token.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
            atob(base64)
            .split("")
            .map(function(c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            })
            .join("")
        );

        return JSON.parse(jsonPayload);
    }

    function updateUserProfile(userData) {
        userProfile = {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            avatar: userData.avatar
        };

        // Update UI
        userName.textContent = userProfile.name;
        userAvatar.src = userProfile.avatar || generateGradientAvatar(userProfile.name);
        userAvatar.style.display = "block";
        signInContainer.style.display = "none";
        playAsGuestButton.style.display = "none";
        logoutButton.style.display = "block";
        authButtons.style.display = "none";
    }

    // --- Session Management ---

    async function checkExistingSession() {
        try {
            // First check for existing token
            const token = getCookie("token");
            const savedGameId = localStorage.getItem('currentGameId');
            // If no token, try to initialize as guest
            if (!token) {
                console.log("No token found, showing auth options");
                hideLoadingScreen();
                showAuthOptions();
                return;
            }

            console.log("Checking session with token:", token);

            // Verify token with server
            const response = await fetch('/api/check-session', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Session check failed: ${response.status}`);
            }

            const data = await response.json();
            console.log("Session data:", data);

            if (data.isAuthenticated) {
                userProfile = {
                    id: data.userId,
                    name: data.name,
                    email: data.email,
                    avatar: data.picture
                };

                // Update UI for authenticated user
                updateAuthenticatedUI();

                // Handle existing game if any
                if (savedGameId) {
                    gameId = savedGameId;
                    await joinGame(gameId);
                } else {
                    initializeGame();
                }
            } else {
                throw new Error('Session not authenticated');
            }
        } catch (error) {
            console.log("Session check failed:", error);
            clearSessionData();
            hideLoadingScreen();
            showAuthOptions();
        }
    }

    // Add helper functions for UI states
    function showAuthOptions() {
        authButtons.style.display = "flex"; // Ensure auth container is shown
        signInContainer.style.display = "block";
        playAsGuestButton.style.display = "block";
        logoutButton.style.display = "none";
        userAvatar.style.display = "none";
        userName.textContent = "";
        userPointsSpan.textContent = "0 Points";
    }

    function updateAuthenticatedUI() {
        userName.textContent = userProfile.name;
        userAvatar.src = userProfile.avatar || generateGradientAvatar(userProfile.name);
        userAvatar.style.display = "block";
        signInContainer.style.display = "none";
        playAsGuestButton.style.display = "none";
        logoutButton.style.display = "block";
        authButtons.style.display = "none";
    }

    function clearSessionData() {
        document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        localStorage.removeItem('currentGameId');
        userProfile = null;
    }

    // --- Fetch User Data ---
    async function fetchUserData(userId) {
        try {
            const response = await fetch(`/api/user/${userId}`);
            if (!response.ok) {
                throw new Error("Failed to fetch user data");
            }
            const data = await response.json();

            userPoints = data.points;
            gameLevel = data.level;
            updateDisplay();

            data.gameHistory.forEach((entry) => {
                addLogEntry(
                    `${entry.won ? "Won" : "Lost"} with "${
            entry.word
          }" on ${new Date(entry.timestamp).toLocaleString()}`
                );
            });
            return data;
        } catch (error) {
            console.error("Error:", error);
            messageContainer.textContent = "Error fetching user data.";
        }
    }

    // --- Create New User ---
    async function createNewUser(userProfile) {
        try {
            const response = await fetch("/api/user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    googleId: userProfile.id,
                    name: userProfile.name,
                    email: userProfile.email,
                    avatar: userProfile.avatar,
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to create new user");
            }

            const newUser = await response.json();
            console.log("New user created:", newUser);

            return newUser;
        } catch (error) {
            console.error("Error creating new user:", error);
            messageContainer.textContent = "Error creating new user.";
            return null;
        }
    }

    // --- Update User Score ---
    async function updateUserScore(userId, points, level, word, won) {
        try {
            const response = await fetch(`/api/user/${userId}/update-score`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    points,
                    level,
                    word,
                    won
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to update user score");
            }

            const data = await response.json();
            console.log("User score updated:", data);

            // Update user points and level in the UI
            userPoints = data.points;
            gameLevel = data.level;
            updateDisplay();

            // Notify other clients about the score update
            socket.emit("score-updated", {
                userId: userId,
                points: userPoints,
                level: gameLevel,
            });
        } catch (error) {
            console.error("Error updating user score:", error);
            messageContainer.textContent = "Error updating user score.";
        }
    }

    // --- Multiplayer Game Creation ---
    async function createMultiplayerGame() {
        try {
            if (!userProfile) {
                messageContainer.textContent = "Please sign in to play multiplayer";
                return;
            }

            const response = await fetch("/api/game/create", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    userId: userProfile.id,
                    wordLength: wordLengthSelect.value,
                    gameMode: "multiplayer",
                }),
                credentials: 'include' // Important for cookies
            });

            if (!response.ok) {
                throw new Error("Failed to create game");
            }

            const data = await response.json();
            gameId = data.gameId; // Set the game ID globally
            localStorage.setItem('currentGameId', gameId); // Store game ID in localStorage

            const gameUrl = `${window.location.origin}/game/${gameId}`;
            await navigator.clipboard.writeText(gameUrl);
            messageContainer.textContent = "Game link copied to clipboard! Share it with your friends.";

            // Update UI to show waiting state
            updateGameState({
                gameState: 'waiting',
                players: [userProfile.id],
                guessesLeft: 6,
                displayedWord: '',
                guessedLetters: []
            });

            // Join the game room
            socket.emit('join-game', {
                gameId,
                userId: userProfile.id
            });
        } catch (error) {
            console.error("Error creating multiplayer game:", error);
            messageContainer.textContent = "Error creating multiplayer game.";
        }
    }

    // --- Join Multiplayer Game ---
    async function joinGame(gameId) {
        try {
            const response = await fetch("/api/game/join", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    gameId,
                    userId: userProfile.id,
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to join game");
            }

            socket.emit("join-game", {
                gameId,
                userId: userProfile.id
            });
        } catch (error) {
            console.error("Error joining game:", error);
            messageContainer.textContent = "Error joining game.";
        }
    }

    // --- Handle Game Mode Change ---
    function handleGameModeChange() {
        const selectedMode = gameModeSelect.value;
        if (selectedMode === "multiplayer") {
            createMultiplayerGame();
        } else {
            initializeGame();
        }
    }

    // --- Game State Update ---
    function updateGameState(data) {
        if (data.word) selectedWord = data.word;
        if (data.displayedWord) displayedWord = data.displayedWord;
        if (data.guessedLetters) guessedLetters = data.guessedLetters;
        if (data.guessesLeft) guessesLeft = data.guessesLeft;
        gameInProgress = data.gameState === "in-progress";

        // Update UI
        updateDisplay();

        // Show whose turn it is
        if (data.turn) {
            const isMyTurn = data.turn === userProfile?.id;
            messageContainer.textContent = isMyTurn ?
                "It's your turn!" :
                "Waiting for other player...";
            enableGameControls(isMyTurn);
        }
    }

    // --- Share Game Functionality ---
    function shareGame() {
        if (!gameId && gameModeSelect.value === 'multiplayer') {
            messageContainer.textContent = "Please create or join a game first";
            return;
        }

        const gameUrl =
            gameId ? `${window.location.origin}/game/${gameId}` : window.location.origin;

        const shareText = `Join me in playing Word Wizard! ${gameUrl}`;

        if (navigator.share) {
            navigator.share({
                title: "Word Wizard - The Ultimate Word Guessing Game!",
                text: shareText,
                url: gameUrl,
            }).catch(error => console.error("Error sharing:", error));
        } else {
            navigator.clipboard.writeText(shareText)
                .then(() => messageContainer.textContent = "Game link copied to clipboard!")
                .catch(error => console.error("Error copying:", error));
        }
    }

    // --- Helper function to get cookie value by name ---
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            const cookieValue = parts.pop().split(';').shift();
            return cookieValue || null;
        }
        return null;
    }

    // --- Add logout function ---
    async function logout() {
        try {
            // Clear server-side session
            await fetch('/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });

            // Clear client-side data
            userProfile = null;
            localStorage.removeItem('currentGameId');
            document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

            // Reset UI
            userAvatar.style.display = "none";
            userName.textContent = "";
            userPointsSpan.textContent = "0 Points";
            logoutButton.style.display = "none";
            authButtons.style.display = "block";
            signInContainer.style.display = "block";

            // Reinitialize Google Sign-In
            initializeGoogleSignIn();

            // Redirect to home or show guest interface
            initializeGuestUser();
        } catch (error) {
            console.error("Error during logout:", error);
            messageContainer.textContent = "Error logging out";
        }
    }

    // --- Event Listeners ---
    guessButton.addEventListener("click", checkGuess);
    newGameButton.addEventListener("click", initializeGame);
    soundToggleButton.addEventListener("click", toggleSound);
    imageHintButton.addEventListener("click", showImageHint);
    definitionHintButton.addEventListener("click", showDefinitionHint);
    letterHintButton.addEventListener("click", showLetterHint);
    extraGuessButton.addEventListener("click", useExtraGuess);
    skipWordButton.addEventListener("click", useSkipWord);
    fiftyFiftyButton.addEventListener("click", useFiftyFifty);
    leaderboardButton.addEventListener("click", () => {
        alert("Leaderboard functionality coming soon!");
    });
    playAsGuestButton.addEventListener("click", initializeGuestUser);
    gameModeSelect.addEventListener("change", handleGameModeChange);
    shareButton.addEventListener("click", shareGame);
    logoutButton.addEventListener("click", logout);

    // --- Initialize Google Sign-In ---
    await initializeGoogleSignIn();
});