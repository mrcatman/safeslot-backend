const fs = require('fs');

const intervals = require("./constants/intervals");
const Game = require('./game');
const AliasesHandler = require('./aliases');

function Exception(message) {
    this.message = message;
}

class GamesList {
    constructor(io, client = null) {
        this.io = io;
        this.client = client;
        this.games = [];
        this.aliases = new AliasesHandler();
        this.planStoragePath = 'src/storage/planner-'+this.client.type+'.json';
        if (fs.existsSync(this.planStoragePath)) {
            this.planned = JSON.parse(fs.readFileSync(this.planStoragePath, 'utf8'));
            if (!this.planned) {
                this.planned = [];
            }
        } else {
            this.planned = [];
        }
        this.planned = this.planned.filter(game => {
            if (game.limitType === "limit_count" && game.limit <= 0) {
                return false;
            } else {
                if (game.limitType === "limit_date") {
                    let dateEnd = game.limit;
                    if (typeof dateEnd.getMonth !== 'function') {
                        dateEnd = new Date(dateEnd);
                    }
                    if (dateEnd.getTime() < new Date().getTime()) {
                        return false;
                    }
                }
            }
            return true;
        });
        this.planned.forEach(game => {
            this.addTimeout(game);
        });
    }


    async addPlanned(conversationId, dateString, limitType, limit, gameName = "") {
        let date = new Date(dateString);
        let conversation = await this.client.getConversationById(conversationId);
        if (!conversation) {
            throw new Exception(`Диалог с id ${conversationId} не найден`);
        }
        let chatName = conversation.name;
        if (!isNaN(date.getTime())) {
            if (['limit_date', 'limit_count'].indexOf(limitType) === -1) {
                throw new Exception("Тип ограничения должен быть один из: limit_date, limit_count");
            }
            if (limitType === "limit_date") {
                let dateEnd = new Date(limit);
                if (isNaN(dateEnd.getTime())) {
                    throw new Exception("Неверный формат даты");
                }
                let game = {
                    conversationId,
                    date,
                    limitType,
                    limit: dateEnd,
                    gameName,
                    chatName
                };
                this.planned.push(game);
                this.updatePlannedList();
                this.addTimeout(game);
                return game;
            } else {
                if (limit && parseInt(limit) > 0) {
                    let game = {
                        conversationId,
                        date,
                        limitType,
                        limit: parseInt(limit),
                        gameName,
                        chatName
                    };
                    this.planned.push(game);
                    this.updatePlannedList();
                    this.addTimeout(game);
                    return game;
                } else {
                    throw new Exception("Не распознан формат окончания. Введите либо дату, либо число игр");
                }
            }
        } else {
            throw new Exception("Не распознана дата. Необходимый формат - YYYY-MM-DDTHH:MM:SS");
        }
    }

    updatePlannedList() {
        let list = [];
        this.planned.forEach(plannedGame => {
            list.push({
                conversationId: plannedGame.conversationId,
                date: plannedGame.date,
                limitType: plannedGame.limitType,
                limit: plannedGame.limit,
                gameName: plannedGame.gameName,
                chatName: plannedGame.chatName
            })
        });
        fs.writeFile(this.planStoragePath, JSON.stringify(list), () => {})
    }

    deletePlanned(index) {
        let plannedGame = this.planned[index];
        if (!plannedGame) {
            throw new Exception("Игра не найдена");
        }
        if (plannedGame._timeout) {
            clearTimeout(plannedGame._timeout);
        }
        this.planned.splice(index, 1);
        this.updatePlannedList();
    }

    editPlannedStart(index, start) {
        let plannedGame = this.planned[index];
        if (!plannedGame) {
            throw new Exception("Игра не найдена");
        }

        let date = new Date(start);
        if (isNaN(date.getTime())) {
            throw new Exception("Неверный формат даты");
        }
        plannedGame.date = date;
        if (plannedGame._timeout) {
            clearTimeout(plannedGame._timeout);
        }
        this.addTimeout(plannedGame);
        this.updatePlannedList();
        return plannedGame;
    }

    editPlannedName(index, name) {
        let plannedGame = this.planned[index];
        if (!plannedGame) {
            throw new Exception("Игра не найдена");
        }
        plannedGame.gameName = name;
        this.updatePlannedList();
        return plannedGame;
    }

    editPlannedLimit(index, limitType, limit) {
        let plannedGame = this.planned[index];
        if (!plannedGame) {
            throw new Exception("Игра не найдена");
        }
        if (['limit_date', 'limit_count'].indexOf(limitType) === -1) {
            throw new Exception("Тип ограничения должен быть один из: limit_date, limit_count");
        }
        if (plannedGame.limitType === "limit_date") {
            clearTimeout(plannedGame._timeout);
        }
        plannedGame.limitType = limitType;
        if (limitType === "limit_date") {
            let date = new Date(limit);
            if (isNaN(date.getTime())) {
                throw new Exception("Неверный формат даты");
            }
            plannedGame.limit = date;
        } else {
            limit = parseInt(limit);
            if (!limit || limit <= 0) {
                throw new Exception("Неверное количество игр");
            }
            plannedGame.limit = limit;
        }
        this.updatePlannedList();
        return plannedGame;
    }

    addTimeout(plannedGame) {
        let start = plannedGame.date;
        if (typeof start.getMonth !== 'function') {
            start = new Date(start);
        }
        let now = new Date();
        if (start.getTime() - now.getTime() > 0) {
            console.log('timeout', start.getTime() - now.getTime());
            if (plannedGame.limitType === "limit_count" && plannedGame.limit <= 0) {
                return;
            }
            if (plannedGame.limitType === "limit_date") {
                let limit =  plannedGame.limit;
                if (typeof limit.getMonth !== 'function') {
                    limit = new Date(limit);
                }
                if (limit.getTime() < now.getTime()) {
                    return;
                }
            }
            if (!plannedGame._game) {
                plannedGame._game = new Game(this, plannedGame.conversationId, this.aliases, this.io, this.client);
                plannedGame._game.prepare();
                plannedGame._game.name = plannedGame.gameName;
            }
            plannedGame._timeout = setTimeout(() => {
                this.createGame( plannedGame._game, plannedGame.conversationId, plannedGame, true);
            }, start.getTime() - now.getTime());
        }
    }

    createGame(game = null, conversationId, planned = null, isFirst = false) {
        //let hasGames = !!(this.findGamesByConversationId(conversationId)[0]);
       // if (!hasGames) {
        if (!game) {
            game = new Game(this, conversationId, this.aliases, this.io, this.client);
            game.prepare();
        }
        if (planned) {
            if (planned.gameName) {
                game.name = planned.gameName;
            }
            game.planned = planned;
            if (isFirst) {
                game.onStart();
                setTimeout(() => {
                    game.start();
                }, intervals.firstStart)
            } else {
                game.start();
            }
        }
        this.games.push(game);
        return game;
       // }
    }

    restart(game) {
        let planned = game.planned;
        this.games.splice(this.games.indexOf(game), 1);
        if (planned) {
            if (planned.limitType === 'limit_date') {
                let dateEnd = planned.limit;
                if (typeof dateEnd.getMonth !== 'function') {
                    dateEnd = new Date(dateEnd);
                }
                let now = new Date();
                if (now.getTime() < dateEnd.getTime()) {
                    this.createGame(null, game.conversationId, planned);
                } else {
                    game.onEnd();
                }
            } else {
                if (planned.limitType === 'limit_count') {
                    if (planned.limit > 1) {
                        planned.limit--;
                        this.createGame(null, game.conversationId, planned);
                    } else {
                        game.onEnd();
                    }
                }
            }
        } else {
            let newGame = this.createGame(null, game.conversationId);
            newGame.start();
        }
    }

    stop(game) {
        this.games.splice(this.games.indexOf(game), 1);
    }

    findGamesByConversationId(conversationId) {
        return this.games.filter(game => game.conversationId.startsWith(conversationId));
    }

    findGamesByUserId(userId) {
        return this.games.filter(game => game.hasUser(userId));
    }

    findGamesByActivePlayerId(userId) {
        return this.games.filter(game => game.player && game.player.id === userId);
    }
}

module.exports =  GamesList;