var socket = null;

const gameStates = { 1: "Joining", 2: "Prompts", 3: "Answers", 4: "Voting", 5: "Results", 6: "Scores", 7: "Game Over" };

//Prepare game
var app = new Vue({
    el: '#game',
    data: {
        connected: false,
        messages: [],
        chatmessage: '',
        username: '',
        password: '',
        confirmPassword: '',
        logged_in: 0,
        newprompt: '',
        me: { admin: false, score: 0, player: false, state: 0 },
        game_state: { state: 1, round: 0 },
        player_state: null,
        players: [],
        audience: [],
        prompt: { index: null, prompt: '' },
        promptAnswer: '',
        votePrompt: null,
        votedFor: 0,
        timer: 0,
        leaderboard: [],
        currentUrl: '',
        submittedAnswers: 0,
        totalExpectedAnswers: 0,
        promptUsers: [],
    },
    mounted: function() {
        this.currentUrl = window.location.href;
        connect();
        // if url is /display, then display
        if (window.location.pathname == '/display') {
            display();
        }
        this.me.state = 0;
    },

    computed: {
        formattedPromptUsers() {
            const userCounts = this.promptUsers.reduce((acc, user) => {
                acc[user] = (acc[user] || 0) + 1;
                return acc;
            }, {});

            const formattedUsers = Object.keys(userCounts).map(user => {
                return userCounts[user] > 1 ? `${user}*${userCounts[user]}` : user;
            });

            if (formattedUsers.length === 0) return 'No prompts have been submitted yet';
            else return formattedUsers.join(', ').replace(/, ([^,]*)$/, ' and $1');
        }
    },


    methods: {
        validateAndSubmit() {
            if (this.username.length < 4 || this.username.length > 14) {
                alert("Username must be between 4 and 14 characters.");
                return false;
            }
            if (this.password.length < 10 || this.password.length > 20) {
                alert("Password must be between 10 and 20 characters.");
                return false;
            }
            // If validation passes, call your original submit method
            this.onSubmit();
        },
        update() {
            this.me = this.me;
            this.game_state = this.game_state;
            this.player_state = this.player_state;
            this.players = this.players;
            this.audience = this.audience;
            this.promptUsers = this.promptUsers;
        },
        handleChat(message) {
            if(this.messages.length + 1 > 10) {
                this.messages.pop();
            }
            this.messages.unshift(message);
        },
        chat() {
            socket.emit('chat', this.chatmessage);
            this.chatmessage = '';
        },
        handleLogin() {
            if (this.username.length < 4 || this.username.length > 16) return;
            if (this.password.length < 8 || this.password.length > 24) return;
            this.update();
            app.update();
            this.me.state = 1;

            socket.emit('login', {username: this.username, password: this.password});
        },
        handleRegister() {
            if (this.username.length < 4 || this.username.length > 16) return;
            if (this.password.length < 8 || this.password.length > 24) return;
            if (this.password != this.confirmPassword) return;
            this.me.state = 1;

            socket.emit('register', {username: this.username, password: this.password});
        },
        handleSubmitPrompt() {
            if (this.logged_in < 1) return;
            this.update();
            if (this.newprompt.length < 15 || this.newprompt.length > 80){
                alert("Prompt less than 15 characters or more than 80 characters");
            } else {
                socket.emit('prompt', {text: this.newprompt, username: this.username, password: this.password});
            }
        },
        handlePromptResponse(message) {
            if (message.result) {
                alert("Prompt created successfully!")
            } else {
                alert(message.message);
            }
        },
        update() {
            // Force Vue to re-render by creating new copies of objects
            this.me = {...this.me};
            this.game_state = {...this.game_state};
            this.player_state = {...this.player_state};
            this.players = [...this.players];
            this.audience = [...this.audience];
            this.promptUsers = [...this.promptUsers];
        },

        handlePromptToAnswer(message) {
            this.me.state = 0;
            this.promptAnswer = '';
            this.prompt = message;
            this.update();
        },
        handleTimer(message) {
            this.timer = message.seconds;
        },
        handleSubmitAnswer() {
            if (this.logged_in < 1) return;

            this.me.state = 1;
            socket.emit('answer', {answer: this.promptAnswer, index: this.prompt.index, username: this.username, password: this.password});
        },
        handleVoteInfo(message) {
            this.votePrompt = message;
        },
        handleVote(index) {
            console.log("Voting for " + index);
            if (this.logged_in < 1) return;

            this.votedFor = index;
            this.me.state = 1;
            const clientIdVote = this.votePrompt.players[index].clientId;
            console.log("Client ID: " + clientIdVote)
            socket.emit('vote', {clientId: clientIdVote, username: this.username, password: this.password});
        },
        handleResults(message) {
            this.me.state = 0;
            this.votePrompt = message;
            this.update();
        },
        handleAdvance() {
            if (this.logged_in < 1) return;
            socket.emit('admin', 'advance');
        },
        handleLoggedIn(message) {
            this.me.state = 0;
            if (message.result === true) {
                this.logged_in = 1;
                this.username = message.username;
                this.me.admin = message.admin;
                this.me.player = message.player;
                this.me.id = message.id;
                this.update();
            } else {
                alert(message.message);
            }
        },
        handleSuccessRegister(message){
            if (message.result){
                alert("Registration successful");
            } else {
                alert("Registration unsuccessful")
            }
        },

        handlePromptBy(message){
            if (message.result){
                this.promptUsers.push(message.message);
                this.update()
            }
        }
    }
});

function display() {
    socket.emit('display', 'display');
}

function connect() {
    //Prepare web socket
    socket = io();

    socket.on('error', function(message) {
        alert('Error: ' + message.message);
    });

    //Connect
    socket.on('connect', function() {
        //Set connected state to true
        app.connected = true;
    });

    //Handle connection error
    socket.on('connect_error', function(message) {
        alert('Unable to connect: ' + message);
    });

    //Handle disconnection
    socket.on('disconnect', function() {
        alert('Disconnected');
        app.connected = false;
    });

    //Handle incoming chat message
    socket.on('chat', function(message) {
        app.handleChat(message);
        console.log("Chat message received: " + message);
    });

    //Handle login
    socket.on('login', function(message) {
        app.handleLoggedIn(message);
    });

    //Handle register
    socket.on('register', function(message) {
        app.handleSuccessRegister(message);
        app.handleLoggedIn(message);
    });

    //Handle prompt
    socket.on('prompt', function(message) {
        //app.handlePromptResponse(message);
    });

    //Handle answer prompt
    socket.on('answer', function(message) {
        app.handlePromptToAnswer(message);
    });

    socket.on('timer', function(message) {
        app.handleTimer(message);
    });

    socket.on('vote', function(message) {
        app.handleVoteInfo(message);
    });

    socket.on('results', function(message) {
        app.handleResults(message);
    });

    socket.on('leaderboard', function(message) {
        console.log(message);
        app.leaderboard = message;
    });

    socket.on('update', function(message) {
        if (message.game_state.state != app.game_state.state) { // Reset player state if game state changes
            app.me.state = 0;
        }
        app.players = message.players;
        app.game_state = message.game_state;
        app.player_state = {...app.player_state, ...message.player_state};
        app.me = {...app.me, ...message.me};
        app.update();
    });

    socket.on("answerUpdate", function(message) {
        app.submittedAnswers = message.submittedAnswers;
        console.log("Updated submitted answers: ", message.submittedAnswers);
    });

    socket.on("expectedAnswersUpdate", function(message) {
        app.totalExpectedAnswers = message.totalExpectedAnswers;
        console.log("Updated total expected answers: ", message.totalExpectedAnswers);
    });

    socket.on("promptBy", function(message){
        app.handlePromptBy(message);
    });

}
