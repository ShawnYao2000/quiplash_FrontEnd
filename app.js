"use strict";

require("dotenv").config();

//Imports
const axios = require("axios");
const express = require("express");
const {post} = require("axios");
//Set up express
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server);
//=======================================================

//TODO: IF YOU WOULD LIKE TO CHANGE THE ENDPOINT, PLEASE NOTE HOW cfg IS CONFIGURED BELOW
// URL of the backend API
const BACKEND_ENDPOINT =  process.env.BACKEND || "https://quiplashfunc.azurewebsites.net/";
const key = process.env.KEY || "lmRiM4TtTWpcthRQJL3jWiieM--KvNsB-aEbafbHmq7HAzFulBqAdw==";

//Azure Set up
const cfg = {
    headers: {
        "x-functions-key": key,
    },
    baseURL: BACKEND_ENDPOINT,
};
const api = axios.create(cfg);
//=======================================================


//Global Variables
const MAX_PLAYERS = 8;
let displays = [];
let clients = { socketToId: new Map(), idToSocket: new Map() };
let playerPasswords = new Map();
let nextClientId = 0;
let players = new Map();
let audience = new Map();
let state = { state: 1, round: 0, submittedAnswers: 0, submittedPrompts: 0 };
let totalExpectedAnswers = 0;
let activePrompts = new Map();
let Timer = {};
let currentPrompt = null;
let currentPromptIndex = 0;
let localPrompts = [];
let remotePrompts = [];
//=======================================================


//Handle client interface on /
app.set("view engine", "ejs");
app.use("/static", express.static("public"));
//=======================================================


//Client Interface Setup
app.get("/", (req, res) => {
    res.render("client");
});
//Handle display interface on /display
app.get("/display", (req, res) => {
    res.render("display");
});
//=======================================================


//Start the server
function startServer() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}
//=======================================================


//Chat message
function handleChat(message, socket) {
    const clientId = clients.socketToId.get(socket);
    if (clientId === undefined) {
        console.log("Client ID not found for chat message");
        return;
    }

    const username = players.has(clientId)
        ? players.get(clientId).username
        : audience.has(clientId)
            ? audience.get(clientId).username
            : "Unknown";

    const timestamp = new Date().toLocaleTimeString();

    console.log(`[${timestamp}] ${username}: ${message}`);
    io.emit("chat", {
        user: username,
        time: timestamp,
        message: message
    });
}
//=======================================================


// Player Authentications - register/login
async function handleRegister({ username, password }, socket) {
    console.log(
        "Handling register: Username:" + username + ", Password:" + password
    );

    try {
        const response = await api
            .post("player/register", {
                username: username,
                password: password,
        });

        const responseBody = response.data;
        if (!responseBody.result) {
            console.error('Register error: ', responseBody.msg);
            socket.emit("register", { result: false, message: responseBody.msg });
        } else {
            console.log("Register for '" + username + "' successful");
            const client = addClient(socket, username, password);
            socket.emit("register", { result: true, username: username, password: password, ...client });
            updateAllPlayers();
        }
    } catch (err) {
        console.error('Request error: ', err.message);
        socket.emit("register", { result: false, message: err.message });
    }
}


//Handle player joining
async function handleLogin({ username, password }, socket) {
    const loginUrl = BACKEND_ENDPOINT + "player/login" + '?code=' + key;

    console.log(
        "Handling login; Username:" + username + ", Password:" + password
    );

    for (const player of players.values()) {
        if (player.username === username) {
            console.error('Login error: User already logged in');
            socket.emit("login", { result: false, message: "User already logged in" });
            return;
        }
    }
    try{
        const response = await axios.get(loginUrl, {
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ username: username, password: password })
        });

        const responseBody = response.data;
        if (!responseBody.result) {
            console.error('Login error: ', responseBody.msg);
            socket.emit("login", { result: false, message: responseBody.msg });
        } else {
            console.log("Login for '" + username + "' successful");
            const client = addClient(socket, username, password);
            socket.emit("login", { result: true, username: username, password: password, ...client });
            updateAllPlayers();
        }
    } catch (err) {
        console.error('Request error: ', err.message);
        socket.emit("login", { result: false, message: err.message });
    }
}

//Get Leaderboard info from db
async function getNewLeaderboard() {
    const getUrl = BACKEND_ENDPOINT + "utils/leaderboard" + '?code=' + key;
    console.log("Getting new leaderboard")

    try {
        const response = await axios.get(getUrl, {
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({top: 5})
        });

        console.log("Getting leaderboard info...")
        let leaderboard = response.data;
        console.log("leaderboard data: ", leaderboard)
        for (const clientSocket of clients.idToSocket.values()) {
            clientSocket.emit("leaderboard", leaderboard);
        }
        for (const display of displays) {
            display.emit("leaderboard", leaderboard);
        }
    } catch (error){
        console.log(error)
    }
}

const addClient = (socket, username, password) => { // Returns 1 4 admin
    const clientId = nextClientId++;
    clients.socketToId.set(socket, clientId);
    clients.idToSocket.set(clientId, socket);

    let player = false;
    const admin = clientId === 0;
    if (players.size < MAX_PLAYERS && state.state === 1) {
        players.set(clientId, {username: username, admin: admin});
        player = true;
    } else {
        audience.set(clientId, {username: username});
        player = false;
    }

    playerPasswords.set(clientId, password);

    getNewLeaderboard();
    return { admin: admin, player: player, id: clientId };
};
//=======================================================


// Update Player info LOCALLY
//SINGLE PLAYER
function updatePlayer(clientId) {
    const clientSocket = clients.idToSocket.get(clientId);
    let playersObj = [];
    [...players.entries()].forEach(([k,v]) => playersObj = [...playersObj, { id: k, ...v }]);

    if (players.has(clientId)) {
        clientSocket.emit("update", { game_state: state, me: players.get(clientId), players: playersObj, audience: [...audience.values()]});
        return;
    }
    if (audience.has(clientId)) {
        clientSocket.emit("update", { game_state: state, me: audience.get(clientId), players: playersObj, audience: [...audience.values()]});
        return;
    }
}

//ALL PLAYERS
function updateAllPlayers() {
    console.log("Updating all players");
    for (const clientId of clients.idToSocket.keys()) {
        updatePlayer(clientId);
    }
    // update displays
    for (const display of displays) {
        let playersObj = [];
        [...players.entries()].forEach(([k,v]) => playersObj = [...playersObj, { id: k, ...v }]);
        display.emit("update", { game_state: state, players: playersObj, audience: [...audience.values()]});
    }
}

async function updatePlayerScores() {
    for (const playerId of players.keys()) {
        try {
            const postData = {
                username: players.get(playerId).username,
                password: playerPasswords.get(playerId),
                add_to_games_played: 1,
                add_to_score: players.get(playerId).total_score || 0
            };
            const response = await api.put("player/update", postData);
            console.log("Score updated for " + players.get(playerId).username);
        } catch (error) {
            console.log("Error updating score for " + players.get(playerId).username, error);
        }
    }
}
//=======================================================


//Handling prompts and answers
async function startPrompts() {
    const getUrl = BACKEND_ENDPOINT + "utils/get" + '?code=' + key;
    let playerList = [];
    for (const player of players.values()) {
        playerList.push(player.username);
    }

    try {
        const response = await axios.get(getUrl, {
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({players: playerList, language: "en"})
        });

        console.log("Getting remote prompts...");
        for (const prompt of response.data) {
            console.log(prompt.text, prompt.username)
            remotePrompts = [...remotePrompts, prompt.text];
        }
    } catch (error) {
        console.error(error);
    }

    //set all player states to 2
    for (const player of players.values()) {
        player.round_score = 0;
    }
}

function startAnswers() {
    //even players
    if (players.size % 2 === 0) {
        const quarter = (players.size / 4) + 0.5;
        const prompts = [...localPrompts.splice(0, quarter), ...remotePrompts.splice(0, quarter)];

        state.submittedAnswers = 0;
        io.emit("answerUpdate", { submittedAnswers: state.submittedAnswers });

        // size/2 prompts
        while (prompts.length > players.size / 2) {
            prompts.pop();
        }
        while (prompts.length < players.size / 2) {
            if (localPrompts.length > 0) { // Prefer local prompts
                prompts.push(localPrompts.pop());
            } else if (remotePrompts.length > 0) { // Use API prompts if no local
                prompts.push(remotePrompts.pop());
            } else { // Use null if no prompts
                prompts.push("null");
            }
        }

        // randomly pair players
        const playersArray = [...players.keys()];
        const shuffledPlayers = playersArray.sort((a,b) => 0.5 - Math.random());
        const pairs = [];
        for (let i = 0; i < shuffledPlayers.length; i += 2) {
            pairs.push([shuffledPlayers[i], shuffledPlayers[i + 1]]);
        }

        let i = 0;
        for (const prompt of prompts) {
            const pair = pairs.pop();
            activePrompts.set(i, { prompt: prompt, players: [{clientId: pair[0], answer: "", votes: 0} , {clientId: pair[1], answer: "", votes: 0}]});
            i++;
        }

        // send prompts to players
        for (const index of activePrompts.keys()) {
            const prompt = activePrompts.get(index);
            for (const player of prompt.players) {
                const clientSocket = clients.idToSocket.get(player.clientId);
                clientSocket.emit("answer", { prompt: prompt.prompt, index: index });
            }
        }

        for (const prompt of activePrompts.values()) {
            totalExpectedAnswers += prompt.players.length;
        }
        io.emit("expectedAnswersUpdate", { totalExpectedAnswers: totalExpectedAnswers });
        console.log("Expecting total answers count of ", totalExpectedAnswers)
    } else {
        // odd players
        const half = Math.ceil(players.size / 2);
        const moreLocal = Math.random() < 0.5;//randomly?
        let localPromptCount = moreLocal ? half : half - 1;
        let remotePromptCount = moreLocal ? half - 1 : half;

        localPromptCount = Math.min(localPromptCount, localPrompts.length);
        remotePromptCount = Math.min(remotePromptCount, remotePrompts.length);

        while (localPromptCount + remotePromptCount > players.size) {
            if (localPromptCount > remotePromptCount) {
                localPromptCount--;
            } else {
                remotePromptCount--;
            }
        }

        while (localPromptCount + remotePromptCount < players.size) {
            if (localPrompts.length > localPromptCount) {
                localPromptCount++;
            } else if (remotePrompts.length > remotePromptCount) {
                remotePromptCount++;
            } else {
                // Add null prompts if no more prompts are available
                localPromptCount++;
            }
        }
        const prompts = [...localPrompts.splice(0, localPromptCount), ...remotePrompts.splice(0, remotePromptCount)];
        // make sure there is only size prompts
        while (prompts.length > players.size) {
            prompts.pop();
        }
        while (prompts.length < players.size) {
            if (localPrompts.length > 0) { // Prefer local prompts
                prompts.push(localPrompts.pop());
            } else if (remotePrompts.length > 0) { // Use API prompts if no local prompts
                prompts.push(remotePrompts.pop());
            } else { // Use null if no prompts
                prompts.push("null");
            }
        }

        // randomly pair
        const playersArray = [...players.keys()];
        let shuffledPlayers = playersArray.sort((a,b) => 0.5 - Math.random());
        shuffledPlayers = [...shuffledPlayers, ...shuffledPlayers];
        const pairs = [];
        for (let i = 0; i < shuffledPlayers.length; i += 2) {
            pairs.push([shuffledPlayers[i], shuffledPlayers[i + 1]]);
        }

        let i = 0;
        for (const prompt of prompts) {
            const pair = pairs.pop();
            activePrompts.set(i, { prompt: prompt, players: [{clientId: pair[0], answer: null, votes: 0} , {clientId: pair[1], answer: null, votes: 0}]});
            i++;
        }

        // send prompts
        for (const playerId of players.keys()) {
            for (const index of activePrompts.keys()) {
                const prompt = activePrompts.get(index);
                if (prompt.players[0].clientId === playerId || prompt.players[1].clientId === playerId) {
                    const clientSocket = clients.idToSocket.get(playerId);
                    clientSocket.emit("answer", { prompt: prompt.prompt, index: index });
                    break;
                }
            }
        }
        for (const prompt of activePrompts.values()) {
            totalExpectedAnswers += prompt.players.length;
        }
        io.emit("expectedAnswersUpdate", { totalExpectedAnswers: totalExpectedAnswers });
        console.log("Expecting total answers count of ", totalExpectedAnswers)

    }
}

function endAnswers() {
    state.state = 4;
    currentPromptIndex = 0;
    clearInterval(Timer.timer);
}

function startVotes() {
    currentPrompt = activePrompts.get(currentPromptIndex);

    if (!currentPrompt) {
        return false;
    }

    // send current prompt to players
    for (const clientSocket of clients.idToSocket.values()) {
        clientSocket.emit("vote", { index: currentPromptIndex, ...currentPrompt });
    }
    for (const display of displays) {
        display.emit("vote", { index: currentPromptIndex, ...currentPrompt });
    }

    return true;
}

function endVotes() {
    currentPromptIndex++;
}
//=======================================================

//start displaying results
function startResults() {
    // calculate result
    for (const result of currentPrompt.players) { //
        const player = players.get(result.clientId);
        const score = result.votes * state.round * 100;
        player.round_score += result.votes * state.round * 100; // 100,200,300...
        result.score = score;
    }

    // send results to players
    for (const clientSocket of clients.idToSocket.values()) {
        clientSocket.emit("results", currentPrompt);
    }

    // send to displays
    for (const display of displays) {
        display.emit("results", currentPrompt);
    }
}

function startScores() {
    // add round scores to total scores
    for (const player of players.values()) {
        player.total_score += player.round_score || 0;
    }
}
//=======================================================



//MASTER FUNC
function nextState(socket) {
    switch (state.state) {
        case 1: // Joining
            if (players.size < 3) {
                socket.emit("error", { message: "Not enough players to start game" });
                return;
            }
            state.state = 2;
            state.round = 1;
            //set total scores to 0
            for (const player of players.values()) {
                player.total_score = 0;
                player.round_score = 0;
            }

            startPrompts();
            break;
        case 2: // Prompts
            startAnswers();
            state.state = 3;
            Timer.remaining = 60;
            for (const clientSocket of clients.idToSocket.values()) {
                clientSocket.emit("timer", { seconds: Timer.remaining });
            }
            for (const display of displays) {
                display.emit("timer", { seconds: Timer.remaining });
            }
            Timer.timer = setInterval(() => {
                Timer.remaining--
                if (Timer.remaining <= 0) {
                    clearInterval(Timer.timer);
                    socket.emit("error", { message: "Not all players have submitted their answers, gameover." });
                    state.state = 7;
                    updateAllPlayers();
                } else {
                    for (const clientSocket of clients.idToSocket.values()) {
                        clientSocket.emit("timer", { seconds: Timer.remaining });
                    }
                    for (const display of displays) {
                        display.emit("timer", { seconds: Timer.remaining });
                    }
                }
            }, 1000);
            break;
        case 3: // Answers
            if (state.submittedAnswers < totalExpectedAnswers) {
                socket.emit("error", { message: "Not all players have submitted their answers." });
                return; // Prevent advancing the state
            } else {
                endAnswers();
                startVotes();
                state.submittedPrompts=0;
            }
            break;
        case 4: // Votes
            endVotes();
            state.state = 5;
            startResults();
            break;
        case 5: // Results
            if (startVotes()) { // If there are more prompts to vote on
                state.state = 4;
            } else { // All rounds done
                state.state = 6;
                startScores();
            }
            break;
        case 6: // Scores
            if (state.round < 3) {
                state.round++;
                state.state = 2;
                state.submittedAnswers = 0;
                io.emit("answerUpdate", { submittedAnswers: state.submittedAnswers });
                totalExpectedAnswers = 0;
                io.emit("expectedAnswersUpdate", { totalExpectedAnswers: totalExpectedAnswers });
                startPrompts();
            } else {
                state.state = 7;
            }
            break;
        case 7: // Game Over
            updatePlayerScores();
            state.state = 1;
            state.submittedAnswers = 0;
            totalExpectedAnswers = 0;
            io.emit("answerUpdate", { submittedAnswers: state.submittedAnswers });
            getNewLeaderboard();
            break;

    }
    updateAllPlayers();
}
//=======================================================
function handleAdmin(socket, message) {
    console.log("Handling admin: " + message);
    if (message === "advance") {
        nextState(socket);
    }
}
async function handleCreatePrompt(socket, message) {
    console.log("Handling prompt: " + message);
    try {
        const response = await api
            .post("prompt/create", {
                text: message.text,
                username: message.username,
            });
        const responseBody = response.data;
        if(!responseBody.result){ // Corrected the variable name here
            console.error('Create prompt error: ', responseBody.msg);
            socket.emit("prompt", { result: false, message: responseBody.msg });
        } else {
            console.log("Create prompt for user: " + message.username + "successful");
            localPrompts.push(message.text);
            socket.emit("prompt", {result: true, message: message.username});
            io.emit("promptBy", {result: true, message: message.username});
            state.submittedPrompts++;
        }
    } catch(err) {
        console.error('Request error: ', err.message);
        socket.emit("prompt", { result: false, message: err.message });
    }
}

function handleAnswer(socket, message) {
    console.log("Handling answer: " + message);

    const clientId = clients.socketToId.get(socket);
    const prompt = activePrompts.get(message.index);

    if (message.answer.trim() === '') {
        // Send a message to the client to show a pop-up alert
        socket.emit('error', 'Please enter an answer before submitting.');
        return;
    }

    if (prompt.players[0].clientId === clientId) {
        prompt.players[0].answer = message.answer;
        state.submittedAnswers++;
        io.emit("answerUpdate", { submittedAnswers: state.submittedAnswers });
        console.log("Answer submitted by player 1: ", state.submittedAnswers);
    } else if (prompt.players[1].clientId === clientId) {
        prompt.players[1].answer = message.answer;
        state.submittedAnswers++;
        io.emit("answerUpdate", { submittedAnswers: state.submittedAnswers });
        console.log("Answer submitted by player 2: ", state.submittedAnswers);
    }

    // If they have another prompt to answer, send it
    for (const index of activePrompts.keys()) {
        const prompt = activePrompts.get(index);
        if (prompt.players[0].clientId === clientId && !prompt.players[0].answer) {
            const clientSocket = clients.idToSocket.get(clientId);
            clientSocket.emit("answer", { prompt: prompt.prompt, index: index });
            break;
        } else if (prompt.players[1].clientId === clientId && !prompt.players[1].answer) {
            const clientSocket = clients.idToSocket.get(clientId);
            clientSocket.emit("answer", { prompt: prompt.prompt, index: index });
            break;
        }
    }
    console.log("Total submitted answers: ", state.submittedAnswers);
}

function handleVote(socket, message) {
    console.log("Handling vote: " + message);
    if (currentPrompt.players.map(player => player.clientId).includes(clients.socketToId.get(socket))) {
        return;
    }
    if (!message.clientId in currentPrompt.players.map(player => player.clientId)) {
        console.log("Player not in current prompt")
        return;
    }

    currentPrompt.players.find(player => player.clientId === message.clientId).votes++;

    // if all players have voted, show scores
    if (currentPrompt.players.map(player => player.votes).reduce((a, b) => a + b) >= clients.socketToId.size - 2) {
        console.log("All players have voted");
        nextState();
    }
}

//Handle new connection
io.on("connection", (socket) => {
    console.log("New connection");

    // ------------------ Handle API calls ------------------
    //Handle login
    socket.on("login", (message) => {
        handleLogin(message, socket);
    });

    //Handle register
    socket.on("register", (message) => {
        handleRegister(message, socket);
    });

    socket.on('prompt', (message) => {
        handleCreatePrompt(socket, message);
    });

    socket.on('answer', (message) => {
        handleAnswer(socket, message);
    });

    socket.on('vote', (message) => {
        handleVote(socket, message);
    });
    // ------------------ Handle API calls ------------------

    //Handle on chat message received
    socket.on("chat", (message) => {
        handleChat(message, socket);
    });

    socket.on('admin', (message) => {
        handleAdmin(socket, message);
    });

    //Handle disconnection
    socket.on("disconnect", () => {
        handleDisconnect(socket);
    });

    socket.on('display', (message) => {
        displays.push(socket);
    });
});

function handleDisconnect(socket) {
    console.log("player disconnected!");

    const clientId = clients.socketToId.get(socket);
    if (clientId === undefined) {
        return;
    }

    clients.socketToId.delete(socket);
    clients.idToSocket.delete(clientId);
    playerPasswords.delete(clientId);

    if (players.has(clientId)) {
        if (players.get(clientId).admin && players.size > 1) {
            players.delete(clientId);
            const newAdmin = players.keys().next().value;
            console.log("New admin: " + newAdmin)
            players.get(newAdmin).admin = true;
        } else {
            players.delete(clientId);
        }
    }
    if (audience.has(clientId)) {
        audience.delete(clientId);
    }
    if (clients.socketToId.size === 0) {
        nextClientId = 0;
    }


    updateAllPlayers();
}

//Start server
if (module === require.main) {
    startServer();
}

module.exports = server;
