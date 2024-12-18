document.addEventListener("DOMContentLoaded", () => {
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

  // --- Constants and Variables ---
  const wordApiUrl = "https://random-word-api.herokuapp.com/word?number=1";
  const imageApiUrl = "https://api.unsplash.com/search/photos?query=";
  const definitionApiUrl =
    "https://api.dictionaryapi.dev/api/v2/entries/en/";

  const imageApiKey = "YOUR-UNSPLASH-API-KEY"; // Replace with your Unsplash API key
  const googleClientId = "YOUR-GOOGLE-CLIENT-ID"; // Replace with your Google Client ID

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

  // --- Game Initialization ---
  async function initializeGame() {
    try {
      showLoadingScreen();
      gameInProgress = false;
      enableGameControls(false); // Disable while loading
      const wordData = await fetchWord();
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
    }
    gameInProgress = false;
    endGame();

    if (userProfile && !isGuestUser) {
      socket.emit("update-score", {
        userId: userProfile.id,
        points: 10,
        level: gameLevel,
        word: selectedWord,
        won: true,
      });
    }
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
      socket.emit("update-score", {
        userId: userProfile.id,
        points: 0, // Or a negative value
        level: gameLevel,
        word: selectedWord,
        won: false,
      });
    }
  }

  // --- Game End ---
  function endGame() {
    enableGameControls(false);
    updateDisplay();
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

  // --- Google Sign-In and Guest Mode ---
  function initializeGoogleSignIn() {
    showLoadingScreen();

    if (typeof google !== "undefined") {
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleCredentialResponse,
      });
      google.accounts.id.renderButton(
        document.getElementById("buttonDiv"),
        { theme: "outline", size: "large" }
      );
      google.accounts.id.prompt();
    } else {
      console.error("Google API not loaded");
      messageContainer.textContent =
        "Error: Google API not loaded. Sign in may not be available.";
      initializeGuestUser();
    }

    hideLoadingScreen();
  }

  async function handleCredentialResponse(response) {
    try {
      const decoded = parseJwt(response.credential);
      isGuestUser = false; // Reset guest user flag
      userProfile = {
        id: decoded.sub,
        name: decoded.name,
        email: decoded.email,
        avatar: decoded.picture,
      };

      userName.textContent = userProfile.name;
      userAvatar.src = userProfile.avatar;
      userAvatar.style.display = "block";
      signInContainer.style.display = "none";
      playAsGuestButton.style.display = "none";

      // Fetch user data from server and update UI
      await fetchUserData(userProfile.id);

      // Notify the server that the user has connected
      socket.emit("user-connected", userProfile.id);

      // Initialize the game after sign-in and data fetch
      initializeGame();
    } catch (error) {
      console.error("Error during Google Sign-In:", error);
      messageContainer.textContent = "Error: Could not sign in with Google.";
    }
  }

  function initializeGuestUser() {
    isGuestUser = true;
    userProfile = null; // No user profile for guests
    userName.textContent = "Guest";
    userAvatar.style.display = "none";
    signInContainer.style.display = "none";
    playAsGuestButton.style.display = "none"; // Hide guest button

    // Initialize the game for the guest user
    initializeGame();
  }

  function parseJwt(token) {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map(function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join("")
    );

    return JSON.parse(jsonPayload);
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
    } catch (error) {
      console.error("Error:", error);
      messageContainer.textContent = "Error fetching user data.";
    }
  }

  // --- Event Listeners ---
  newGameButton.addEventListener("click", initializeGame);
  soundToggleButton.addEventListener("click", toggleSound);
  imageHintButton.addEventListener("click", showImageHint);
  definitionHintButton.addEventListener("click", showDefinitionHint);
  letterHintButton.addEventListener("click", showLetterHint);
  extraGuessButton.addEventListener("click", useExtraGuess);
  skipWordButton.addEventListener("click", useSkipWord);
  fiftyFiftyButton.addEventListener("click", useFiftyFifty);
  guessButton.addEventListener("click", checkGuess);
  leaderboardButton.addEventListener("click", () => {
    alert("Leaderboard functionality coming soon!");
  });
  playAsGuestButton.addEventListener("click", initializeGuestUser);

  // --- Initialize Google Sign-In ---
  initializeGoogleSignIn();
});