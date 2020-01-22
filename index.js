const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const VkBot = require('node-vk-bot-api');

const {vkModerators, discordModerators} = require('./src/constants/moderators');
const {vkToken, vkConfirmation, discordToken} = require("./src/constants/secure");
const states = require('./src/constants/states');
const gamesList = require('./src/gamesList');

const vkClientClass = require('./src/clients/vkClient');
const discordClientClass = require('./src/clients/discordClient');


const app = express();
const server = http.createServer(app);
const socket = require('socket.io');

const Discord = require('discord.js');
const discordApiClient = new Discord.Client();
discordApiClient.login(discordToken);
let discordReady = false;

const bot = new VkBot({
    token: vkToken,
    confirmation: vkConfirmation,
});

let io = socket(server);

const vkClient = new vkClientClass();
let vkGamesList = new gamesList(io, vkClient);

const discordClient = new discordClientClass(discordApiClient);
let discordGamesList = null;

discordApiClient.on("ready", () => {
    discordReady = true;
    discordGamesList = new gamesList(io, discordClient);
});

let lastDate = 0;
bot.on(async(ctx) => {
    if (ctx.message.date >= lastDate) {
        lastDate = ctx.message.date;
        const conversationId = ctx.message.peer_id;
        const msg = ctx.message.text.trim();
        const isFromChat = conversationId > 2000000000;
        const userId = isFromChat ? ctx.message.from_id : ctx.message.peer_id;
        const isModerator = vkModerators.indexOf(userId) !== -1;
        const reply = (text) => {
            console.log(text);
            return ctx.reply(text);
        };
        const conferenceId = ctx.message.peer_id;
        handler(vkGamesList, isModerator, msg, isFromChat, conferenceId, userId, reply);
    }
});

discordApiClient.on("message", async message => {
    if (message.author.bot) return;
    const isModerator = discordModerators.indexOf(parseInt(message.author.id)) !== -1;
    const msg = message.content.trim();
    const isFromChat =  message.channel.type !== 'dm';
    const conferenceId = message.channel.id;
    const reply = (text) => {
        console.log(text);
        message.reply(text);
    };
    const userId = message.author.id;
    console.log(userId);
    handler(discordGamesList, isModerator, msg, isFromChat, conferenceId, userId, reply);
});

let handler = async(gl, isModerator, msg, isFromChat, conferenceId, userId, reply) => {
    console.log(msg);
    if (isModerator && msg.startsWith("!!")) {
        let data = msg.split(" ");
        let command = data.shift().replace("!!", "");
        let firstArgument = null;
        if (!isFromChat) {
            firstArgument = data.shift();
        } else {
            firstArgument = conferenceId;
        }
        let conversationId = firstArgument;
        let arguments = data;
        try {
            switch (command) {
                case "date":
                    let currentDate = new Date();
                    reply(`Серверное время - ${currentDate.toISOString()}`);
                    break;
                case "plan":
                    let args = JSON.parse(JSON.stringify(arguments));
                    args.splice(0, 3);
                    let name = args.join(" ");
                    let plannedGame = await gl.addPlanned(conversationId, arguments[0], arguments[1], arguments[2], name);
                    if (plannedGame.limitType === "limit_date") {
                        reply(`Запланирована игра с ${plannedGame.date.toString()} по ${plannedGame.limit.toString()}`);
                    } else {
                        reply(`Запланирована игра с ${plannedGame.date.toString()}, лимит игр: ${plannedGame.limit}`);
                    }
                    break;
                case "announceplan":
                    let number = parseInt(firstArgument);
                    if (gl.planned[number]) {
                        let plannedGame = gl.planned[number];
                        let start = plannedGame.date;
                        if (typeof start.getMonth !== 'function') {
                            start = new Date(start);
                        }
                        // gl.client.sendMessage(message, conversationId);
                        let date = start.toLocaleDateString().split("-");
                        let time = start.toLocaleTimeString().split(":");
                        let message = `Запланирована игра на ${date[2]}.${date[1]}.${date[0]} в ${time[0]}:${time[1]}`;
                        reply(message);
                        gl.client.sendMessage(message, plannedGame.conversationId);
                    } else {
                        reply("Игра не найдена")
                    }
                    break;
                case "deleteplan":
                    gl.deletePlanned(firstArgument);
                    reply(`Запланированная игра удалена`);
                    break;
                case "editplanname":
                    gl.editPlannedName(firstArgument, arguments[0]);
                    reply(`Название запланированной игры отредактировано`);
                    break;
                case "editplanstart":
                    let _plannedGame = gl.editPlannedStart(firstArgument, arguments[0]);
                    if (_plannedGame && _plannedGame._game) {
                        _plannedGame._game.update('plannedDate', _plannedGame.date);
                    }
                    reply(`Время старта запланированной игры отредактировано`);
                    break;
                case "editplanlimit":
                    gl.editPlannedLimit(firstArgument, arguments[0], arguments[1]);
                    reply(`Лимиты запланированной игры отредактированы`);
                    break;
                case "listplan":
                    if (gl.planned.length > 0) {
                        let allPlannedGames = gl.planned.map(game => {
                            return `ID конференции: ${game.conversationId}; Название: ${game.gameName}; Время: ${game.date};${game.limitType === 'limit_date' ? 'время окончания: '+game.limit.toString() : 'лимит игр: '+game.limit}`
                        }).join("\n");
                        reply(allPlannedGames);
                    } else {
                        reply("Не запланировано ни одной игры");
                    }
                    break;
                case "listconf":
                    let conferences = await gl.client.listConferences();
                    reply(conferences.join('\n'));
                    break;
                case "whoami":
                    let user = await gl.client.getUserById(userId);
                    reply(JSON.stringify(user));
                    break;
                case "listgames":
                    if (gl.games.length > 0) {
                        let allGames = gl.games.map(game => {
                            `ID конференции: ${game.conversationId}; участников: ${game.users.length}; Статус: ${game.state}`;
                        }).join('\n');
                        reply(allGames);
                    } else {
                        reply("Сейчас нет активных игр");
                    }
                    break;
                case "debug":
                    let games = gl.findGamesByConversationId(conversationId);
                    if (games.length > 0) {
                        reply(JSON.stringify(games[0].getGameState()))
                    } else {
                        reply("Не найдено ни одной игры в этой конференции")
                    }
                    break;
                case "create":
                    gl.createGame(null, conversationId, null, true);
                    reply("Игра создана");
                    break;
                case "start":
                    let gameToStart = gl.findGamesByConversationId(conversationId)[0];
                    if (gameToStart) {
                        gameToStart.start();
                        reply("Игра начата");
                    }
                    break;
                case "fastcreate":
                    let game = gl.createGame(null, conversationId, null, true);
                    game.start();
                    reply("Игра создана и начата");
                    break;
                case "stop":
                    let gameToStop = gl.findGamesByConversationId(conversationId)[0];
                    if (gameToStop) {
                        gameToStop.stop();
                        reply("Игра остановлена");
                    }
                    break;
                case "sendmessage":
                    let message = arguments.join(" ");
                    gl.client.sendMessage(message, conversationId);
                    break;
                default:
                    break;
            }
        } catch (e) {
            console.log(e);
            reply(e.message);
        }
    } else {
        if (parseInt(msg) > 0 && !isFromChat) {
            let game = gl.findGamesByUserId(userId)[0];
            if (game) {
                let number = parseInt(msg);
                if (game.state === states.STATE_WAITING_FOR_ANSWERS) {
                    game.setSelectionAnswer(userId, number, reply);
                }
                if (game.state === states.STATE_WAITING_FOR_PLAYER_ANSWER) {
                    game.setInteractiveAnswer(userId, number, reply);
                }
            }
        } else {
            if (msg.startsWith("!") && isFromChat) {
                let game = gl.findGamesByActivePlayerId(userId)[0];
                if (game) {
                    game.parsePlayerMessage(msg.substring(1));
                }
            }
            if (msg.startsWith("/") && isFromChat) {
                if (msg === "/next") {
                    let plannedGame = gl.planned.filter(plannedGame => plannedGame.conversationId.startsWith(conferenceId))[0];
                    if (plannedGame) {
                        let start = plannedGame.date;
                        if (typeof start.getMonth !== 'function') {
                            start = new Date(start);
                        }
                        reply(`Следующая игра: ${plannedGame.gameName}. Состоится: ${start.toLocaleDateString()} в ${start.toLocaleTimeString()}`);
                    } else {
                        reply("Не запланировано ни одной игры");
                    }
                } else {
                    if (msg === "/allgames") {
                        let planned = [...vkGamesList.planned, ...discordGamesList.planned].map(plannedGame => {
                            let start = plannedGame.date;
                            if (typeof start.getMonth !== 'function') {
                                start = new Date(start);
                            }
                            return `Игра: ${plannedGame.gameName}. Конференция: ${plannedGame.chatName}. Дата и время: ${start.toLocaleString()}`;
                        });
                        if (planned.length > 0) {
                            reply(['Все запланированные игры', '', ...planned].join('\n'));
                        } else {
                            reply("Не запланировано ни одной игры");
                        }
                    } else {
                        let game = gl.findGamesByUserId(userId)[0];
                        if (game) {
                            game.parseCommand(userId, msg.substring(1));
                        }
                    }
                }
            }
        }
    }
}

server.listen(3001, function () {
    console.log('Listening on port 3001');
});


app.use(bodyParser.json());
app.post('/', bot.webhookCallback);


io.on('connection', (socket) => {
	socket.on('room', ({type, room}) => {
		socket.join(room);
		let gl = type === 'vk' ? vkGamesList : discordGamesList;
		if (!gl) {
		    return;
        }
        let planned = null;
		let game = gl.findGamesByConversationId(parseInt(room))[0];
        if (!game) {
            let gameData = gl.planned.filter(plannedGame => plannedGame._game && plannedGame.conversationId.startsWith(room))[0];
            if (gameData) {
                game = gameData._game;
                planned = gameData;
            }
        }

        if (game) {
            game.connectSocket(socket);
			if (game.state === states.STATE_NOT_STARTED && planned) {
			    socket.emit('update', {
			        plannedDate: planned.date,
                })
            }
		}
	});
});

app.get('/stream', function(req, res){
    res.sendFile(__dirname + '/static/index.html');
});