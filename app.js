    document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
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
    const loadingScreen = document.getElementById('loading-screen');
    const container = document.querySelector('.container');

    // Constants and Variables
    const wordApiUrl = "https://random-word-api.herokuapp.com/word?number=1";
    const imageApiUrl = "https://api.unsplash.com/search/photos?query=";
    const imageApiKey = "YOUR-UNSPLASH-API";

    let selectedWord = "";
    let displayedWord = "";
    let guessedLetters = [];
    let guessesLeft = 6;
    let userProfile = null;
    let gameLevel = 1;
    let userPoints = 0;
    let soundEnabled = true;
    const socket = io(); // Connect to the Socket.IO server

    socket.on('connect', () => {
        console.log('Connected to socket server');
    });

    socket.on('gameLogUpdate', (logEntry) => {
        addLogEntry(logEntry);
    });

    // Modify checkGameStatus to send updates through Socket.IO
    function checkGameStatus() {
        // ... (rest of the logic)
            if (guessesLeft === 0) {
            messageContainer.textContent = `You lost! The word was ${selectedWord}.`;
            addLogEntry(`${userProfile.name} lost the game. The word was "${selectedWord}".`);
            // Send update through Socket.IO
            socket.emit('gameOver', { user: userProfile.name, word: selectedWord, level: gameLevel, points: userPoints });
            endGame();
        } else if (displayedWord === selectedWord) {
            userPoints += 10; // Award points for correct word
            gameLevel++; // Increase the level
            messageContainer.textContent = "You won!";
            addLogEntry(`${userProfile.name} won the game! Word: ${selectedWord}, Points: ${userPoints}, Level: ${gameLevel}`);
            // Send update through Socket.IO
            socket.emit('gameWon', { user: userProfile.name, word: selectedWord, level: gameLevel, points: userPoints });
            endGame();
        }
    }

    // Game Initialization
    async function initializeGame() {
        if (!userProfile) {
            messageContainer.textContent = "Please sign in to play.";
            return;
        }
        
        try {
            const wordData = await fetchWord();
            selectedWord = wordData.word;
            console.log("selected word: " + selectedWord);

            await fetchImageForWord(selectedWord);
            initializeGameState();
            updateDisplay();
            addLogEntry(`${userProfile.name} started a new game. Level: ${gameLevel}`);
        } catch (error) {
            console.error("Error initializing game:", error);
            messageContainer.textContent = "Error: Could not initialize the game.";
        }
    }

    async function fetchWord() {
        try {
            const response = await fetch(wordApiUrl);
            const data = await response.json();
            return { word: data[0], definition: 'Sample definition' };
        } catch (error) {
            console.error("Error fetching word:", error);
            // Fallback word list
            const fallbackWords = [
                { word: "example", definition: "A representative instance." },
                // Add more fallback words as needed
            ];
            const randomIndex = Math.floor(Math.random() * fallbackWords.length);
            return fallbackWords[randomIndex];
        }
    }

    async function fetchImageForWord(word) {
        try {
            const response = await fetch(`${imageApiUrl}${word}&client_id=${imageApiKey}`);
            const data = await response.json();
            if (data.results && data.results.length > 0) {
                const imageUrl = data.results[0].urls.regular;
                imageContainer.innerHTML = `<img src="${imageUrl}" alt="Word Image">`;
            } else {
                imageContainer.innerHTML = '<p>No image found</p>';
            }
        } catch (error) {
            console.error("Error fetching image:", error);
            imageContainer.innerHTML = '<p>Error loading image</p>';
        }
        imageContainer.classList.add("fade-in");
    }

    function initializeGameState() {
        displayedWord = Array(selectedWord.length).fill('_').join('');
        guessedLetters = [];
        guessesLeft = 6;
        // Reset power-ups or other game state variables as needed
    }

    function updateDisplay() {
        wordContainer.innerHTML = displayedWord.split('').join(' ');
        guessesLeftSpan.textContent = guessesLeft;
        messageContainer.textContent = "";
        letterInput.value = "";
        letterInput.disabled = false;
        guessButton.disabled = false;
        gameLevelSpan.textContent = `Level ${gameLevel}`;
        userPointsSpan.textContent = `${userPoints} Points`;
    }

    // Event Handlers
    function checkGuess() {
        const letter = letterInput.value.toLowerCase();

        if (!isValidLetter(letter)) {
            messageContainer.textContent = "Invalid input. Please enter a single letter.";
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
            addLogEntry(`${userProfile.name} guessed "${letter}" correctly.`);
            animateCorrectGuess();
        } else {
            guessesLeft--;
            messageContainer.textContent = "Incorrect guess.";
            addLogEntry(`${userProfile.name} guessed "${letter}" incorrectly.`);
            animateIncorrectGuess();
        }

        updateDisplay();
        checkGameStatus();
    }

    function isValidLetter(letter) {
        return /^[a-z]$/i.test(letter);
    }

    function updateDisplayedWord(letter) {
        let newDisplayedWord = '';
        for (let i = 0; i < selectedWord.length; i++) {
            if (selectedWord[i] === letter) {
                newDisplayedWord += letter;
            } else {
                newDisplayedWord += displayedWord[i];
            }
        }
        displayedWord = newDisplayedWord;
    }

    function checkGameStatus() {
        if (guessesLeft === 0) {
            messageContainer.textContent = `You lost! The word was ${selectedWord}.`;
            addLogEntry(`${userProfile.name} lost the game. The word was "${selectedWord}".`);
            endGame();
        } else if (displayedWord === selectedWord) {
            userPoints += 10; // Award points for correct word
            gameLevel++; // Increase the level
            messageContainer.textContent = "You won!";
            addLogEntry(`${userProfile.name} won the game! Word: ${selectedWord}, Points: ${userPoints}, Level: ${gameLevel}`);
            endGame();
        }
    }

    function endGame() {
        letterInput.disabled = true;
        guessButton.disabled = true;
        // Handle other end-of-game logic here (e.g., saving scores, updating leaderboards)
    }

    // Animation Functions
    function animateCorrectGuess() {
        gsap.to(wordContainer, {
            duration: 0.5,
            scale: 1.2,
            color: "green",
            ease: "elastic.out(1, 0.3)",
            yoyo: true,
            repeat: 1,
            onComplete: () => {
                gsap.set(wordContainer, { clearProps: "all" }); // Reset styles
            }
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
                gsap.set(guessesLeftSpan, { clearProps: "all" }); // Reset styles
            }
        });
    }

    // Hint Functions
    function showImageHint() {
        // Placeholder for image hint logic
        // This could involve showing a blurred image or a part of the image
    }

    function showDefinitionHint() {
        // Display the definition of the word fetched earlier
        messageContainer.textContent = `Definition: ${selectedWord.definition}`;
    }

    function showLetterHint() {
        // Reveal a random letter in the word that hasn't been guessed yet
        let unrevealedIndices = [];
        for (let i = 0; i < selectedWord.length; i++) {
            if (!guessedLetters.includes(selectedWord[i])) {
                unrevealedIndices.push(i);
            }
        }
        if (unrevealedIndices.length > 0) {
            const randomIndex = unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)];
            const letterToReveal = selectedWord[randomIndex];
            updateDisplayedWord(letterToReveal);
            guessedLetters.push(letterToReveal);
            updateDisplay();
        }
    }

    // Power-up Functions
    function useExtraGuess() {
        guessesLeft++;
        updateDisplay();
        messageContainer.textContent = "You got an extra guess!";
    }

    function useSkipWord() {
        initializeGame();
        messageContainer.textContent = "Word skipped!";
    }

    function useFiftyFifty() {
        // Eliminate half of the incorrect letters not yet guessed
        let incorrectLetters = [];
        for (let charCode = 97; charCode <= 122; charCode++) {
            let letter = String.fromCharCode(charCode);
            if (!selectedWord.includes(letter) && !guessedLetters.includes(letter)) {
                incorrectLetters.push(letter);
            }
        }
        incorrectLetters.sort(() => 0.5 - Math.random()); // Shuffle array
        let lettersToRemove = incorrectLetters.slice(0, Math.floor(incorrectLetters.length / 2));
        for (let letter of lettersToRemove) {
            guessedLetters.push(letter);
        }
        messageContainer.textContent = "50/50 used! Some incorrect letters removed.";
    }

    // Utility Functions
    function addLogEntry(entry) {
        const newLogItem = document.createElement("li");
        newLogItem.textContent = entry;
        logList.appendChild(newLogItem);

        // Keep the log to a certain number of entries
        if (logList.children.length > 10) {
            logList.removeChild(logList.firstChild);
        }
    }

    function toggleSound() {
        soundEnabled = !soundEnabled;
        // Update the button text or icon based on the sound state
        soundToggleButton.textContent = soundEnabled ? "Sound: ON" : "Sound: OFF";
    }

    // Google Sign-In
    function handleCredentialResponse(response) {
        // Decode the JWT to get user information
        const decoded = parseJwt(response.credential); // Implement parseJwt() - see below
        userProfile = {
            id: decoded.sub,
            name: decoded.name,
            email: decoded.email,
            avatar: decoded.picture
        };

        // Update UI with user info
        userName.textContent = userProfile.name;
        userAvatar.src = userProfile.avatar;

        // Initialize the game for the signed-in user
        initializeGame();
    }

    // Helper function to decode JWT (you might need a library for this in production)
    function parseJwt(token) {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    }

    // Event Listeners
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
        // Placeholder for leaderboard display logic
        alert("Leaderboard functionality coming soon!");
    });

    // Initialize Google Sign-In
    window.onload = function () {
        google.accounts.id.initialize({
            client_id: "YOUR_GOOGLE_CLIENT_ID",
            callback: handleCredentialResponse
        });
        google.accounts.id.renderButton(
            document.getElementById("buttonDiv"),
            { theme: "outline", size: "large" }
        );
        google.accounts.id.prompt();
    };

    // Show game content after loading
    loadingScreen.style.display = 'none';
    container.style.display = 'block';
});