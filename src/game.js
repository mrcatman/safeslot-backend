const md5 = require('md5');
const {randomArrayItems, randomInteger, randomString} = require("./randomUtils");
const states = require("./constants/states");
const {fieldCols, fieldRows, totalFields} = require("./constants/field");
const intervals = require("./constants/intervals");
const fatalsCounts = require("./constants/fatalsCounts");
const {defaultHints, hintsNames, hintsDescriptions, bombNames, bombDescription} = require("./constants/hints");

const emoji = require('./constants/emoji');
const discordEmoji = require('./constants/discordEmoji');

const {mainTree} = require('./constants/trees');
const ResultsSaver = require('./resultsSaver');

class Game {
    constructor(list, conversationId, aliases, io, apiClient) {
        this.defaultSelectionData = {
            number: 100,
            min: 1,
            max: 999,
            random_string: '',
            timestamp: 0,
            md5: ''
        };
        this.resultsSaver = new ResultsSaver();
        this.io = io;
        this.aliases = aliases;
        this.parentList = list;
        this.conversationId = ""+conversationId;
        this.users = [];
        this.setGameState(states.STATE_NOT_STARTED);
        this.selectionAnswers = [];
        this.selectionData = JSON.parse(JSON.stringify(this.defaultSelectionData));
        this.round = 0;
        this.field = this.generateField(fieldRows, fieldCols);
        this.fieldElements = [].concat.apply([], this.field);
        this.fieldObject = [];
        this.fatals = [];
        this.fatalsString = "";
        this.currentSum = 0;
        this.treeObject = [];
        this.safetyNets = [];
        this.hasBomb = null;
        this.bombPosition = null;
        this.hints = {};
        this.timeouts = {};
        this.selectedHint = null;
        this.usedHint = false;
        this.interactive = {};
        this.interactiveNames = {};
        this.interactiveRoundAnswers = {};
        this.currentTrack = null;
        this.apiClient = apiClient;
        this.name = "";
    }

    getSessionName() {
        let today = new Date();
        let dd = String(today.getDate()).padStart(2, '0');
        let mm = String(today.getMonth() + 1).padStart(2, '0');
        let yyyy = today.getFullYear();
        let fullDate =  dd + '.' + mm + '.' + yyyy;
        return fullDate;
    }

    getSocketID() {
        return this.conversationId;
    }

    update(name, value = null) {
        if (!value) {
            value = this[name];
        }
        let data = {};
        data[name] = value;
        this.io.in(this.getSocketID()).emit('update', data);
    }

    playTrack(name) {
        this.currentTrack = name;
        this.io.in(this.getSocketID()).emit('play_track', name);
        if (this.apiClient.playTrack) {
            this.apiClient.playTrack(this.conversationId, name);
        }
    }

    setGameState(state) {
        this.state = state;
        this.update('state');
    }

    updateUsers() {
        let users = JSON.parse(JSON.stringify(this.users));
        users.forEach(user => {
            user.alias = this.aliases.get(user.id);
        });
        this.update('users');
    }

    getGameState() {
        let state = JSON.stringify(this, ((key, val) => {
            let hidden = ['resultsSaver','aliases', 'io', 'parentList', 'fatals', 'bombPosition', 'interactive', 'interactiveRoundAnswers', 'timeouts', 'defaultSelectionData', 'apiClient', 'planned'];
            if (hidden.indexOf(key) !== -1) {
                return undefined;
            }
            return val;
        }));
        state = JSON.parse(state);
        state.fatalsString = md5(state.fatalsString);
        return state;
    }

    getParams() {
        return {
            intervals,
            states,
            fieldCols,
            fieldRows,
            totalFields,
            fatalsCounts,
            mainTree
        };
    }

    connectSocket(socket) {
        socket.join(this.getSocketID());
        socket.emit('initial_state',  this.getGameState());
        socket.emit('params', this.getParams());
        socket.emit('play_track', 'slot_main.mp3');
        this.updateUsers();
    }

    generateField(rows, cols) {
        let field = [];
        let i = 1;
        for (let j = 1; j <= cols; j++) {
            let row = [];
            for (let k = 1; k <= rows; k++) {
                row.push(i);
                i++;
            }
            field.push(row);
        }
        return field;
    }

    getUserByName(name) {
        let users = this.users.filter(user => {
            if (user.name && user.name.indexOf(name) !== -1) {
                return true;
            }
            if (user.alias && user.alias.indexOf(name) !== -1) {
                return true;
            }
            if (user.screen_name && user.screen_name.indexOf(name) !== -1) {
                 return true;
            }
            let fullName = user.first_name+" "+user.last_name;
            if (fullName.indexOf(name) !== -1) {
                return true;
            }
        });
        if (users.length > 0) {
            return users[0];
        } else {
            return null;
        }
    }

    async getUserById(userId) {
        let users = this.users.filter(user => parseInt(user.id) === parseInt(userId));
        if (users.length > 0) {
            return users[0];
        } else {
            let user = await this.apiClient.getUserById(userId);
            if (user) {
                this.users.push(user);
                user.alias = this.aliases.get(user.id);
                user.name = await this.getNameById(user.id);
                return user;
            }
            return null;
        }
    }

    async getNameById(userId) {
        let user = await this.getUserById(userId);
        if (user) {
            if (user.alias) {
                return user.alias;
            }
            if (user.username) {
                return user.username;
            }
            return user.first_name+" "+user.last_name;
        } else {
            return "id_"+userId;
        }
    }

    hasUser(userId) {
        return this.users.filter(user => parseInt(user.id) === parseInt(userId)).length > 0;
    }

    async prepare() {
        this.io.in(this.getSocketID()).emit('initial_state',  this.getGameState());
        this.io.in(this.getSocketID()).emit('params',  this.getParams());
      //  this.playTrack('slot_intro.mp3');
        this.apiClient.getUsers(this.conversationId).then(async (res) => {
            this.users = res;
            for (let userKey in this.users) {
                this.users[userKey].alias = this.aliases.get(this.users[userKey].id);
                this.users[userKey].name = await this.getNameById(this.users[userKey].id);
            }
            this.updateUsers();
        });
        if (this.apiClient.joinAdditionalChannel) {
            this.apiClient.joinAdditionalChannel(this.conversationId);
        }
    }

    mention(user) {
        return this.apiClient.mention(user);
    }

    async parseCommand(userId, message) {
        let messageData = message.split(" ");
        let command = messageData.shift();
        let argument = messageData.join(" ");
        let user = await this.getUserById(userId);
        if (user) {
            if (command === 'alias') {
                //if (this.apiClient.name === "vk" || true) {
                    await this.sendMessage(`${this.mention(user)}, ваш ник изменен на ${argument}`);
                    user.name = argument;
                    user.alias = argument;
                    this.aliases.set(userId, argument);
                    this.updateUsers();
                //} else {
                //    await this.sendMessage(`${this.mention(user)}, смена ника в Discord не поддерживается из-за его особенностей`);
                //}
            }
            if (command === 'slap') {
                let slappedUser = await this.getUserByName(argument);
                if (slappedUser) {
                    const shuffle = (a) => {
                        for (let i = a.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [a[i], a[j]] = [a[j], a[i]];
                        }
                        return a;
                    };
                    let shuffledUsername = shuffle(slappedUser.name.split("")).join("");
                    let messages = [
                        `${user.name} шлепнул ${this.mention(slappedUser)} тухлой позапрошлогодней форелью!`,
                        `${user.name} шлёпнул ${this.mention(slappedUser)} здоровенной форелью так, что от ${slappedUser.name} осталось ${shuffledUsername}!`,
                        `${user.name} шлепнул ${this.mention(slappedUser)} здоровенной форелью моей мечты`,
                        `${user.name} slaps ${this.mention(slappedUser)} around a bit with a large trout`,
                    ];
                    let message = messages[Math.floor(Math.random()*messages.length)];
                    await this.sendMessage(message);
                } else {
                    await this.sendMessage(`${this.mention(user)} пытался шлепнуть кого-то форелью...но промахнулся(`);
                }
            }
            if (command === 'inter') {
                let results = null;
                if (argument === "all") {
                    results = (await this.resultsSaver.getResults(this.getSessionName()));
                } else {
                    results = (await this.resultsSaver.getAllResults());
                }
                let interactiveResults = results.interactive;
                let interactiveNames = results.interactiveNames ?  results.interactiveNames : {};
                if (interactiveResults && Object.keys(interactiveResults).length > 0) {
                    let resultsList = [];
                    let users = {};
                    let maxNameLength = 0;
                    for (let userId in interactiveResults) {
                        let name = interactiveNames[userId] ? interactiveNames[userId].name : null;
                        if (!name) {
                            name = "id_"+userId;
                        }
                        resultsList.push({score: interactiveResults[userId], text: `${name.padEnd(maxNameLength + 7, '.')}${interactiveResults[userId].toString().padStart(5, '.')}`});
                    }
                    resultsList = resultsList.sort((a, b) => b.score > a.score).map(result => result.text);
                    await this.sendMessage('```' + resultsList.join('\n') + '```');
                } else {
                    await this.sendMessage("Пока в интерактиве пусто");
                }
            }
            if (command === 'results') {
                let results = null;
                if (argument === "all") {
                    results = (await this.resultsSaver.getAllResults());
                } else {
                    results = (await this.resultsSaver.getResults(this.getSessionName()));
                }

                let counts = {};
                let scores = {};
                let players = {};
                let maxNameLength = 0;
                if ( results.players &&  results.players.length > 0) {
                    results.players.forEach(game => {
                        if (game.player.name && game.player.name.length > maxNameLength) {
                            maxNameLength = game.player.name.length;
                        }
                        let playerId = game.player.id;
                        if (!players[playerId]) {
                            players[playerId] = game.player;
                        }
                        if (!counts[playerId]) {
                            counts[playerId] = 0;
                        }
                        if (!scores[playerId]) {
                            scores[playerId] = 0;
                        }
                        counts[playerId]++;
                        scores[playerId]+=game.sum;
                    });
                    let resultsList = [];
                    console.log(maxNameLength);
                    for (let index in players) {
                        let player = players[index];
                        let name = player.name;
                        resultsList.push({score: scores[player.id], text: `${name.padEnd(maxNameLength + 5, '.')} ${scores[player.id].toString().padStart(4, '.')}Р [${counts[player.id].toString().padStart(2)}]`});
                    }
                    resultsList = resultsList.sort((a, b) => b.score > a.score).map(result => result.text);
                    await this.sendMessage('```' + resultsList.join('\n') + '```');
                } else {
                    await this.sendMessage("Пока в игре пусто");
                }
            }
        }
    }

    async start() {
        this.setGameState(states.STATE_STARTING);
        this.selectionData = JSON.parse(JSON.stringify(this.defaultSelectionData));
        this.setGameState(states.STATE_SHOWING_RANGE);
        this.playTrack('slot_ff_get_ready.mp3');
        this.setSelectionRoundNumbers();
        this.sendMessage([
            "Добро пожаловать в Свободный Слот!",
            "Диапазон отборочного раунда: ("+(this.selectionData.min)+"-"+(this.selectionData.max)+")",
            "[MD5: "+this.selectionData.md5+"]",
        ]);
        this.timeouts.start = setTimeout(async () => {
            await this.sendMessage(`Время пошло! У вас ${intervals.selectionDuration} секунд`);
            this.playTrack('slot_ff_time.mp3');
            this.setGameState(states.STATE_WAITING_FOR_ANSWERS);
            this.selectionData.timestamp = new Date().getTime();
            this.timeouts.showResults = setTimeout(()=>{
                this.selectionRoundResults()
            }, intervals.selectionDuration * 1000);
        }, intervals.startSelection * 1000);
    }

    async selectionRoundResults() {
        await this.sendMessage([
            "Отбор завершен!",
            "Загаданное число: "+this.selectionData.number,
            "Строка: "+this.selectionData.string
        ]);
        this.selectionAnswers = this.selectionAnswers.sort((a, b) => {
            let abs1 = Math.abs(this.selectionData.number - a.number);
            let abs2 = Math.abs(this.selectionData.number - b.number);
            if (abs1 === abs2) {
                return a.seconds < b.seconds;
            }
            return (abs1 - abs2);
        });
        for (let key in this.selectionAnswers) {
            let answer = this.selectionAnswers[key];
            answer.name = await this.getNameById(answer.userId);
            answer.seconds = (answer.time - this.selectionData.timestamp) / 1000;
            answer.best = answer.userId === this.selectionAnswers[0].userId;
        }
        this.update('selectionData');
        this.update('selectionAnswers');
        this.setGameState(states.STATE_SHOWING_RESULTS);
        this.playTrack('slot_ff_results.mp3');
        if (this.selectionAnswers.length > 0) {
            let results = this.selectionAnswers.map((answer) => {
                return (answer.best ? emoji.correct : emoji.user)+" "+answer.name+" ["+answer.number.toString().padStart(3)+"] "+answer.seconds.toString().padStart(10, ".");
            });
            await this.sendMessage(results);
            const timeoutSeconds = intervals.selectPlayerTimeout;
            this.timeouts.selectPlayer = setTimeout(() => {
                this.selectPlayer(this.selectionAnswers[0].userId);
            }, timeoutSeconds * 1000)

        } else {
            this.setGameState(states.STATE_NO_SELECTION_ANSWERS);
            const timeoutSeconds = intervals.noAnswersTimeout;
            this.playTrack('slot_ff_all_wrong.mp3');
            await this.sendMessage(`Увы, ни одного ответа не поступило :( Попробуем еще раз через ${timeoutSeconds} секунд`);
            this.timeouts.restart = setTimeout(() => {
                this.start();
            }, timeoutSeconds * 1000)
        }
    }

    async selectPlayer(userId) {
        this.player = await this.getUserById(userId);
        let defaultHintsSeconds = intervals.defaultHints;
        let hintsTexts = [];
        Object.keys(hintsNames).forEach(hintId => {
            let hint = hintsNames[hintId];
            let hintAltNames = hint.filter((hintName, index) => {
                return index !== 1;
            });
            hintsTexts.push(`[${hint[1]}] (${hintAltNames.join(', ')})`)
        });
        await this.sendMessage(
            [
                `${this.mention(this.player)}, играем с вами!`,
                'Введите список подсказок, с которыми вы будете играть, а также хотите ли вы играть с "бомбой"',
                `Через ${defaultHintsSeconds} секунд автоматически будет выбран список подсказок по умолчанию.`,
                    `Доступные подсказки: `,
                ...hintsTexts
            ]
        );
        this.playTrack('slot_contestant.mp3');
        this.update('player');
        if (this.timeouts.defaultHints) {
            clearTimeout(this.timeouts.defaultHints);
        }
        this.timeouts.defaultHints = setTimeout(() => {
            this.selectDefaultHints();
        }, 1000 * defaultHintsSeconds);
        this.setGameState(states.STATE_WAITING_FOR_HINTS_LIST);
    }

    generateFieldString(selected = null, status = null, fatals = [], hidden = [], bombPosition = null, onSelect = false) {
        let fieldString = null;
        if (this.apiClient.type === 'vk') {
            fieldString = this.field.map(row => {
                return row.map(fieldItem => {
                    return fieldItem >= 10 ? fieldItem : "0" + fieldItem
                }).map(fieldItem => {
                    let fieldItemNumber = parseInt(fieldItem);
                    if (hidden.indexOf(fieldItemNumber) !== -1) {
                        return `[${emoji.fatal}..${emoji.fatal}]`;
                    } else {
                        if (selected && selected === fieldItemNumber) {
                            return status ? `[${emoji.correct}${fieldItem}${emoji.correct}]` : (bombPosition === fieldItemNumber ? `[${emoji.bombBoom}${fieldItem}${emoji.bombBoom}]` : `[${emoji.fatalBoom}${fieldItem}${emoji.fatalBoom}]`);
                        } else {
                            return fatals.indexOf(fieldItemNumber) === -1 ? ((selected === null ? `[${emoji.default}${fieldItem}${emoji.default}]` : `[${emoji.empty}${fieldItem}${emoji.empty}]`)) : (bombPosition === fieldItemNumber ? `[${emoji.bomb}${fieldItem}${emoji.bomb}]` : `[${emoji.fatal}${fieldItem}${emoji.fatal}]`);
                        }
                    }
                }).join(" ")
            })
        } else {
            if (this.apiClient.type === 'discord') {
                let field = this.field;
                if (onSelect) {
                    field = field.filter(row => {
                        return row.filter(item => parseInt(item) === selected).length > 0
                    })
                }
                fieldString = field.map(row => {
                    return discordEmoji.padding + row.map(fieldItem => {
                        let paddingSymbol = discordEmoji.default;
                        let fieldItemNumber = parseInt(fieldItem);
                        let fieldItemText = fieldItem >= 10 ? ""+fieldItem : "0" + fieldItem;
                        let fieldEmoji = fieldItemText.split("").map(number => {
                            return discordEmoji.numbers[number];
                        }).join("");
                        if (onSelect) {
                            paddingSymbol = selected === fieldItemNumber ? discordEmoji.selected : discordEmoji.unselected;
                        } else {
                            if (hidden.indexOf(fieldItemNumber) !== -1) {
                                paddingSymbol = discordEmoji.fatal;
                                fieldEmoji = `${discordEmoji.hiddenFatal}${discordEmoji.hiddenFatal}`;
                            } else {
                                if (selected && selected === fieldItemNumber) {
                                    if (status) {
                                        paddingSymbol = discordEmoji.correct;
                                    } else {
                                        if (bombPosition === fieldItemNumber) {
                                            paddingSymbol = discordEmoji.bombBoom;
                                        } else {
                                            paddingSymbol = discordEmoji.fatalBoom;
                                        }
                                    }
                                } else {
                                    if (fatals.indexOf(fieldItemNumber) !== -1) {
                                        if (bombPosition === fieldItemNumber) {
                                            paddingSymbol = discordEmoji.bomb;
                                        } else {
                                            paddingSymbol = discordEmoji.fatal;
                                        }
                                    } else {
                                        if (selected === null) {
                                            paddingSymbol = discordEmoji.default;
                                        } else {
                                            paddingSymbol = discordEmoji.empty;
                                        }
                                    }
                                }
                            }
                        }
                        return `${paddingSymbol}${fieldEmoji}${paddingSymbol}`;
                    }).join(discordEmoji.padding)+discordEmoji.padding;
                })
            }
        }
        this.fieldObject = this.field.map(row => {
            return row.map(fieldItem => {
                return fieldItem >= 10 ? fieldItem : "0"+fieldItem
            }).map(fieldItem => {
                let fieldItemNumber = parseInt(fieldItem);
                let data = {
                    number: fieldItem,
                    int: fieldItemNumber
                };
                if (hidden.indexOf(fieldItemNumber) !== -1) {
                   data.fatal = true;
                   data.hiddenFatal = true;
                } else {
                    if (selected && selected === fieldItemNumber) {
                        data.selected = true;
                        if (status) {
                            data.correct = true;
                        } else {
                            if (bombPosition === fieldItemNumber) {
                                data.bomb = true;
                            } else {
                                data.fatal = true;
                            }
                        }
                    } else {
                        if (fatals.indexOf(fieldItemNumber) === -1) {
                            if (selected === null) {
                                data.default = true;
                            } else {
                                data.empty = true;
                            }
                         } else {
                            if (bombPosition === fieldItemNumber) {
                                data.bomb = true;
                            } else {
                                data.fatal = true;
                            }
                        }
                    }
                }
                return data;
            })
        });
        this.update('fieldObject');
        return fieldString;
    }



    async sendTree() {
        let sums = [];
        mainTree.forEach((sum, index) => {
            sums[index] = `${sum.toFixed(2)} Р`
        });
        let list = [];
        let maxLength = mainTree.map(sum => sum.toString().length).reduce(function (a, b) { return a > b ? a : b; });
        for (let j = 0; j <= 2; j++) {
            let row = [];
            for (let i = 1; i <= 3; i++) {
                let n = 3 * i - j;
                let sum = sums[n - 1];
                let startEmoji = this.round === n ? emoji.correct : (this.safetyNets.indexOf(n) !== -1 ? emoji.safetyNet : emoji.numbers[n]);
                let str = startEmoji + " "+ sum.padStart(maxLength - sum.length + 3, ".");
                row.push(str);
            }
            list.push(row);
        }
        this.treeObject = mainTree.map((sum, n) => {
            return {
                sum: `${sum.toFixed(2)} Р`,
                current: this.round === n + 1,
                safetyNet: this.safetyNets.indexOf(n) !== -1
            }
        });
        if (this.round >= 3) {
            this.playTrack(`slot_ld_${this.round}.mp3`);
        }
        this.update('treeObject');
        let line = "";
        for (let i = 0; i < list[list.length - 1].length * 2; i++) {
            line += "_";
        }
        list.push(line);
        list.push([...Object.keys(this.hints).map(hintId => "["+(this.hints[hintId].usedAt ? emoji.unavailable : emoji.correct)+" "+hintsNames[hintId][0]+" ] "), this.hasBomb ? "[ BOMB ]" : ""].join(" "));
        await this.sendMessage(list);
    }

    async nextRound() {
        this.interactiveRoundAnswers = {};
        this.selectedHint = null;
        this.usedHint = false;
        this.round++;
        this.update('selectedHint');
        this.update('round');
        if (this.round === 1 || this.round === 4 || this.round >= 7) {
            await this.sendTree();
            this.timeouts.startNextRound = setTimeout(() => {
                this.startRound();
            }, intervals.roundAfterTree * 1000)
        } else {
            this.startRound();
        }
    }

    async startRound() {
         let fatalsInRound = fatalsCounts[this.round - 1];
        this.fatals = randomArrayItems(this.fieldElements, fatalsInRound);
        if (this.hasBomb && this.round >= 4) {
            this.bombPosition = this.fatals[Math.floor(Math.random()*this.fatals.length)];
        }
     //   console.log('fatals', this.fatals);
        this.fatalsString = randomString(1, 5) + "_" + this.fatals.join("|") + "_" + randomString(1, 5);
        if (this.bombPosition) {
            this.fatalsString+= "_BOMB_" + this.bombPosition;
        }
        await this.sendMessage([
            `Раунд #${this.round}`,
            ...this.generateFieldString(),
            "MD5: "+md5(this.fatalsString),
            "Интерактив работает"
        ]);
        if (this.round === 1) {
            this.playTrack('slot_r1.mp3');
        } else {
            if (this.round >= 4) {
                this.playTrack(`slot_r${this.round}.mp3`);
            } else {
                if (this.currentTrack !== 'slot_r1.mp3') {
                    this.playTrack('slot_r1.mp3');
                }
            }
        }
        this.update('fatalsString', md5(this.fatalsString));
        this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
        if (this.timeouts.kickInactive) {
            clearTimeout(this.timeouts.kickInactive);
        }
        this.timeouts.kickInactive = setTimeout(() => {
            this.kickInactivePlayer();
        }, intervals.kickInactive * 1000)
    }

    setSelectionRoundNumbers() {
        this.selectionData.min = randomInteger(1,998);
        this.selectionData.max = randomInteger(this.selectionData.min, 999);
        this.selectionData.number = randomInteger(this.selectionData.min, this.selectionData.max);
        this.selectionData.string = randomString(1, 5) + this.selectionData.number+"_"+randomString(1, 5);
        this.selectionData.md5 = md5(this.selectionData.string);
        let data = JSON.parse(JSON.stringify(this.selectionData));
        data.number = null;
        data.string = null;
        this.update('selectionData', data);
    }

    async sendMessage(text) {
        let message = text;
        if (Array.isArray(text)) {
            message = text.join("\n");
        }
        return await this.apiClient.sendMessage(message, this.conversationId);
    }

    async setSelectionAnswer(userId, number, reply) {
        if (this.state === states.STATE_WAITING_FOR_ANSWERS) {
            if (this.selectionData.min <= number && number <= this.selectionData.max) {
                let time = new Date().getTime();
                if (this.selectionAnswers.filter(answer => answer.userId === userId).length > 0) return;
                this.selectionAnswers.push({userId, number, time});
                //await reply("Ваш ответ в отборочном раунде принят");
            } else {
                await reply(`Число ${number} не входит в диапазон значений [${this.selectionData.min}] - [${this.selectionData.max}]`);
            }
        }
    }

    async setInteractiveAnswer(userId, number, reply) {
        if (this.player && this.player.id == userId) return;
        if (!this.interactive[userId]) {
            this.interactive[userId] = 0;
        }
        this.interactiveNames[userId] = await this.getNameById(userId);
        if (number >= 1 && number <= totalFields) {
            if (!this.interactiveRoundAnswers[userId]) {
                if (this.fatals.indexOf(number) === -1) {
                    this.interactive[userId] += 10 * this.fatals.length;
                } else {
                    if (this.bombPosition === number) {
                        this.interactive[userId] = 0;
                    } else {
                        this.interactive[userId] -= 5 * this.fatals.length;
                    }
                }
                this.interactiveRoundAnswers[userId] = number;
            }
        }

    }

    async kickInactivePlayer() {
        let lastSafetyNet = this.safetyNets.filter(safetyNet => safetyNet < this.round).sort().reverse()[0];
        if (lastSafetyNet) {
            this.currentSum = mainTree[lastSafetyNet - 1];
        } else {
            this.currentSum = 0;
        }
        this.saveResults();
        await this.sendMessage(`${this.mention(this.player)}, увы, вы слишком долго не отвечали, и поэтому были кикнуты из игры.`);
        this.update('currentSum');
        this.setGameState(states.STATE_KICKED_FOR_INACTIVITY);

        this.timeouts.reset = setTimeout(() => {
            this.resetGame();
        }, intervals.restartGame * 1000);
    }

    async handlePass() {
        if (this.round >= 1) {
            this.setGameState(states.STATE_PASS);
            await this.sendMessage(`${this.mention(this.player)}, вы решили уйти с деньгами. Итоговый выигрыш - ${this.currentSum} Р.`);
            this.saveResults();
            this.timeouts.reset = setTimeout(() => {
                this.resetGame();
            }, intervals.restartGame * 1000);
        }
    }

    async handlePlayerAnswer(answer) {
        if (this.timeouts.kickInactive) {
            clearTimeout(this.timeouts.kickInactive);
        }
        this.timeouts.kickInactive = setTimeout(() => {
            this.kickInactivePlayer();
        }, intervals.kickInactive * 1000);
        if (["pas", "pass", "пас"].indexOf(answer) !== -1) {
            this.handlePass();
            return;
        }
        if (this.selectedHint === 'alternative') {
            this.handleAlt(answer);
        } else {
            if (!isNaN(answer) && parseInt(answer) !== 50) {
                this.setGameState(states.STATE_INGAME_INACTIVE);
                let selectedField = parseInt(answer);
                if (selectedField >= 1 && selectedField <= totalFields) {
                    this.update('selectedField', selectedField);
                    if (this.round >= 4) {
                        this.setGameState(states.STATE_CHECKING_ANSWER);
                    }

                    const getRandomNum = (min, max) => (Math.random() * (max - min + 1)) + min;
                    let timeout = this.round >= 4 ? (getRandomNum(intervals.showResultsMin, intervals.showResultsMax) + this.round - 5 + (this.selectedHint === 'double' && !this.usedHint ? 3 : 0)) : 1;

                    let randomSelectMessages = [
                        `Выбран слот №${selectedField}.`,
                        `Принято: слот под номером ${selectedField}.`,
                        `Зафиксирован слот номер ${selectedField}!`,
                        `Выбор остановлен на слоте под номером ${selectedField}! `,
                        `Выбор игрока — слот №${selectedField}.`,
                        `Слот под номером ${selectedField} зафиксирован!`,
                        `Окончательный ответ — №${selectedField}! `,
                        `Участник выбрал слот №${selectedField}. `,
                        `Ответ участника — №${selectedField}. `,
                        `Узнаем, свободен ли слот номер ${selectedField}… `,
                    ];
                    let selectMessage = randomSelectMessages[Math.floor(Math.random()*randomSelectMessages.length)];
                    await this.sendMessage([
                        this.generateFieldString(selectedField, true, [], [], null, true)[0],
                        ``,
                        selectMessage,
                        `Приём ответов в интерактив остановлен!`
                    ]);

                    if (this.selectedHint === 'double') {
                        if ( !this.usedHint) {
                            this.playTrack('slot_double_1st_answer.mp3');
                        } else {
                            this.playTrack('slot_double_2nd_answer.mp3');
                        }
                    } else {
                        if (this.round >= 4) {
                            this.playTrack(`slot_final_${this.round}.mp3`);
                        }
                    }

                    this.timeouts.showAnswer = setTimeout(async () => {
                        let answerIsWrong = this.fatals.indexOf(selectedField) !== -1;
                        this.update('fatalsString', this.fatalsString);
                        if (!answerIsWrong) {
                            this.setGameState(states.STATE_ROUND_WIN);
                            this.currentSum = mainTree[this.round - 1];
                            this.update('currentSum');
                            let sumString = [`--------------------(${this.currentSum} Р)--------------------`];
                            if (this.apiClient.type === 'discord') {
                                let stringLength = fieldRows * 5 + 1;
                                let totalSumLength = 4;
                                let paddingLength = (stringLength - totalSumLength) / 2 - 1;
                                let sumLength = this.currentSum.toString().length;
                                let sumEmoji = this.currentSum.toString().split("").map(number => {
                                    if (number === ".") {
                                        return discordEmoji.dot;
                                    }
                                    return discordEmoji.numbers[number];
                                }).join("");
                                sumString = [`${discordEmoji.sumPaddingStart.repeat(paddingLength)}${discordEmoji.sumPaddingEnd}${discordEmoji.sumEmpty.repeat(totalSumLength - sumLength)}${sumEmoji}${discordEmoji.sumPaddingEnd}${discordEmoji.sumPaddingStart.repeat(paddingLength)}`];
                                sumString.push(discordEmoji.sumEmpty);
                            }
                            await this.sendMessage([
                                "Свободный слот!",
                                ...sumString,
                                ...this.generateFieldString(selectedField, true, this.fatals, [], this.bombPosition),
                                "Строка: " + this.fatalsString
                            ]);
                            if (this.round >= 4) {
                                this.playTrack(`slot_correct_${this.round}.mp3`);
                            }
                          //  let track = this.round <= 2 ? 'slot_correct_1-2.wav' : ;

                            if (this.round < mainTree.length) {
                                this.timeouts.nextRound = setTimeout(() => {
                                    this.nextRound();
                                }, intervals.nextRound * 1000);
                            } else {
                                this.setGameState(states.STATE_GAME_WIN);
                                await this.sendMessage([
                                    "ВЫ - ПОБЕДИТЕЛЬ ИГРЫ!",
                                    `${this.mention(this.player)}, вы один из немногих, кто дошел до финала игры и смог победить Великий Рандом.`,
                                    `Ваш итоговый выигрыш составил ${this.currentSum} Р.`
                                ]);
                                this.saveResults();
                                this.timeouts.reset = setTimeout(() => {
                                    this.resetGame();
                                }, intervals.restartGame * 1000);
                            }
                        } else {
                            let isBomb = this.bombPosition === selectedField;
                            let fatalName = isBomb ? "БОМБА" : "ФАТАЛ";
                            if (this.selectedHint === 'double' && !this.usedHint) {
                                this.playTrack(isBomb ? 'slot_double_2nd_chance_bomb.mp3' : 'slot_double_2nd_chance.mp3');
                                await this.sendMessage([
                                    `${fatalName}! (но у вас еще есть второй шанс)`,
                                    ...this.generateFieldString(selectedField, false, [selectedField]),
                                ]);
                                this.usedHint = true;
                                this.update('usedHint');
                                this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
                            } else {
                                let track = this.round <= 3 ? 'slot_wrong_1-3.mp3' : `slot_wrong_${this.round}${isBomb ? '_bomb' : ''}.mp3`;
                                this.playTrack(track);
                                this.setGameState(isBomb ? states.STATE_ROUND_LOSE_BOMB : states.STATE_ROUND_LOSE);
                                await this.sendMessage([
                                    `${fatalName}!`,
                                    ...this.generateFieldString(selectedField, false, this.fatals, [], this.bombPosition),
                                    "Строка: " + this.fatalsString
                                ]);
                                if (isBomb) {
                                    this.currentSum = 0;
                                } else {
                                    let lastSafetyNet = this.safetyNets.filter(safetyNet => safetyNet < this.round).sort().reverse()[0];
                                    if (lastSafetyNet) {
                                        this.currentSum = mainTree[lastSafetyNet - 1];
                                    } else {
                                        this.currentSum = 0;
                                    }
                                }
                                this.saveResults();
                                this.timeouts.lose = setTimeout(async() => {
                                    this.update('currentSum');
                                    this.setGameState(states.STATE_SHOWING_WON_SUM);
                                    await this.sendMessage([
                                        `${this.mention(this.player)}, увы, вы дошли до ${this.round} раунда и проиграли.`,
                                        `Ваш выигрыш составил ${this.currentSum} Р.`
                                    ]);
                                    this.timeouts.reset = setTimeout(() => {
                                        this.resetGame();
                                    }, intervals.restartGame * 1000);
                                }, intervals.showSum * 1000);

                            }
                        }
                    }, timeout * 1000)
                } else {
                    this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
                    await this.sendMessage(`Введите число от 1 до ${totalFields}`);
                }
            } else {
                //if (!this.usedHint) {
                    let selectedHint = null;
                    Object.keys(this.hints).forEach(hintId => {
                        hintsNames[hintId].forEach(hintName => {
                            if (answer.indexOf(hintName) !== -1) {
                                selectedHint = hintId;
                            }
                        })
                    });
                    if (selectedHint) {
                        if (!this.hints[selectedHint].usedAt) {
                            this.setGameState(states.STATE_HINT_ACTIVE);
                            this.selectedHint = selectedHint;
                            await this.sendMessage(`[${this.hints[selectedHint].name}] Подсказка "${this.hints[selectedHint].fullName}" активирована!`);
                            await this.useHint(answer);
                        } else {
                            await this.sendMessage(`Подсказка [${this.hints[selectedHint].fullName}] уже использована`);
                        }
                    } else {
                        await this.sendMessage("Не распознан ответ");
                    }
               // } else {
               //     await this.sendMessage("Вы уже использовали подсказку в этом раунде");
               // }
            }
        }
    }

    async useHint(answer) {
        let hint = this.selectedHint;
        if (hint === 'alternative') {
            this.hints.alternative.usedAt = this.round;
            let free = this.fieldElements.filter(field => this.fatals.indexOf(field) === -1);
            let randomFatal = this.fatals[Math.floor(Math.random()*this.fatals.length)];
            let randomFree = free[Math.floor(Math.random() * free.length)];
            this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
            this.hints.alternative.variants = (Math.random() > 0.5) ? [randomFatal, randomFree] : [randomFree, randomFatal];
            this.playTrack('slot_alternative.mp3');
            await this.sendMessage([
                `Сделайте выбор: [${this.hints.alternative.variants[0]}] или [${this.hints.alternative.variants[1]}]`
            ]);
            this.usedHint = true;
            this.update('selectedHint');
            this.update('hints');
        }
        if (hint === 'locator') {
            let numbers = [];
            let range = answer.split(" ").filter(number => number.indexOf("-") !== -1)[0];
            if (range) {
                range = range.split("-");
                for (let i = range[0]; i <= range[1]; i++) {
                    numbers.push(i);
                }
            } else {
                numbers = answer.split(" ").map(number => parseInt(number)).filter(number => (number >= 1 && number <= totalFields));
            }
            numbers = numbers.map(number => {
                return parseInt(number);
            })
            if (numbers && numbers.length > 0) {
                this.hints.locator.usedAt = this.round;
                this.hints.locator.selectedNumbers = numbers;
                let fatals = numbers.filter(number => this.fatals.indexOf(number) !== -1);
                let free = numbers.length - fatals.length;
                await this.sendMessage([
                    `Найдено ${fatals.length} фаталов и ${free} свободных слотов`,
                ]);
                this.playTrack('slot_locate.wav');
                this.hints.locator.counts = {
                    fatals: fatals.length,
                    free,
                };
                this.usedHint = true;
                this.update('selectedHint');
                this.update('hints');
            } else {
                await this.sendMessage([
                    `Некорректно введена команда. Примеры использования: !loc 1 2 3; !loc 1-7`,
                ]);
            }
            this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
        }
        if (hint === 'gps') {
            this.hints.gps.usedAt = this.round;
            let checkRows = [];
            let checkCols = [];
            if (Math.random() > 0.5) {
                for (let i = 1; i <= fieldRows; i++) {
                    let row = [];
                    for (let  j = 1; j <= fieldCols; j++) {
                        row.push(i + (j - 1) * fieldRows);
                    }
                    checkCols.push(row);
                }
            } else {
                for (let i = 1; i <= fieldCols; i++) {
                    let row = [];
                    for (let  j = 1; j <= fieldRows; j++) {
                        row.push(j + (i - 1) * fieldRows);
                    }
                    checkRows.push(row);
                }
            }
            let checkFatals = (row) => {
                return row.filter(field => this.fatals.indexOf(field) === -1).length;
            };
            let freeNumbersRows = [];
            let freeNumbersCols = [];
            checkRows.forEach(checkRow => {
                freeNumbersRows.push(checkFatals(checkRow));
            });
            checkCols.forEach(checkRow => {
                freeNumbersCols.push(checkFatals(checkRow));
            });
            let maxRows = Math.max(...freeNumbersRows);
            let maxCols = Math.max(...freeNumbersCols);

            let type = null;
            let name = null;
            let freeNumbers = null;
            let max = null;
            if (maxRows > maxCols) {
                type = 0;
                name = 'строке';
                max = maxRows;
                freeNumbers = freeNumbersRows;
            } else {
                type = 1;
                name = 'столбце';
                max = maxCols;
                freeNumbers = freeNumbersCols;
            }
            let indexes = [];
            freeNumbers.forEach((number, index) => {
                if (number === max) {
                    indexes.push(index);
                }
            });

            let index = indexes[Math.floor(Math.random()*indexes.length)] + 1;
            this.hints.gps.index = index;
            this.hints.gps.typeName = name;
            this.hints.gps.type = type;
            await this.sendMessage([
                `Свободный слот проще найти в ${index} ${name}`
            ]);
            this.playTrack('slot_gps.mp3');
            this.update('selectedHint');
            this.update('hints');
            this.usedHint = true;
            this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
        }
        if (hint === 'onehalf') {
            if (this.round > 1) {
                this.hints.onehalf.usedAt = this.round;
                const shuffle = (a) => {
                    for (let i = a.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [a[i], a[j]] = [a[j], a[i]];
                    }
                    return a;
                };
                let hiddenFatals = shuffle(JSON.parse(JSON.stringify(this.fatals))).splice(0, Math.floor(this.fatals.length / 2));
                await this.sendMessage([
                    `Половина фаталов удалена с поля:`,
                   ...this.generateFieldString(null, null, [], hiddenFatals),
                ]);
                this.playTrack('slot_fifty.wav');
                this.hints.onehalf.hiddenFatals = hiddenFatals;
                this.update('selectedHint');
                this.update('hints');
                this.usedHint = true;

            } else {
                await this.sendMessage([
                    `Данная подсказка доступна начиная со 2 раунда`,
                ]);
            }
            this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
        }
        if (hint === 'double') {
            this.hints.double.usedAt = this.round;
            this.update('selectedHint');
            this.update('hints');
            this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
            this.playTrack('slot_double_activated.mp3');
        }
        if (hint === 'voice') {
            let answersCounts = {};
            let maxValue = 0;
            Object.values(this.interactiveRoundAnswers).forEach(answer => {
                if (!answersCounts[answer]) {
                    answersCounts[answer] = {answer, count: 0};
                }
                answersCounts[answer].count++;
                if (answersCounts[answer].count > maxValue) {
                    maxValue = answersCounts[answer].count;
                }
            });
            let maxValues = Object.values(answersCounts).filter(value => value.count === maxValue);
            if (maxValues.length === 1) {
                this.hints.voice.usedAt = this.round;
                this.usedHint = true;
                let popular = maxValues[0].answer;
                this.hints.voice.popular = popular;
                this.update('selectedHint');
                this.update('hints');
                this.playTrack('slot_audience.mp3');
                await this.sendMessage([
                    `Самый популярный ответ в интерактиве - слот под номером [${popular}]`,
                ]);
            } else {
                await this.sendMessage([
                    `В интерактиве пока что нет самых популярных ответов`,
                ]);
            }
            this.setGameState(states.STATE_WAITING_FOR_PLAYER_ANSWER);
        }
    }

    async handleAlt(answer) {
        if (!isNaN(answer)) {
            let number = parseInt(answer);
            if (this.hints.alternative.variants.indexOf(number) !== -1) {
                this.playTrack('slot_alternative_activated.mp3');
                this.selectedHint = null;
                this.handlePlayerAnswer(answer);
            } else {
                await this.sendMessage(`Выберите из 2 вариантов: либо ${this.hints.alternative.variants[0]}, либо ${this.hints.alternative.variants[1]}`);
            }
        } else {
            await this.sendMessage("Не распознан ответ");
        }
    }

    end() {
        this.setGameState(states.STATE_GAME_ENDED);
        for (let timeoutKey in this.timeouts) {
            clearTimeout(this.timeouts[timeoutKey]);
        }
        if (this.apiClient && this.apiClient.onLeave) {
            this.apiClient.onLeave(this.conversationId);
        }
    }
    resetGame() {
        this.end();
        this.parentList.restart(this);
    }

    stop() {
        this.end();
        this.parentList.stop(this);
    }

    selectDefaultHints() {
        defaultHints.forEach(hintId => {
            this.hints[hintId] = {
                usedAt: null,
                fullName: hintsNames[hintId][1],
                name: hintsNames[hintId][0]
            }
        });
        this.hasBomb = false;
        this.update('hasBomb');
        this.update('hints');
        this.nextRound();
    }

    async parseSafetyNet(answer) {
        if (!isNaN(answer) && parseInt(answer) >= 1 && parseInt(answer) <= mainTree.length) {
            this.safetyNets = [parseInt(answer)];
            this.update('safetyNets');
            this.setGameState(states.STATE_INGAME_INACTIVE);
            this.onHintsSelected();
        } else {
            await this.sendMessage(`Введите корректный номер раунда от 1 до ${mainTree.length}`);
        }
    }

    onHintsSelected() {
        this.playTrack('slot_game_set.mp3');
        this.timeouts.onHintsSelected = setTimeout(() => {
            this.playTrack(this.hasBomb ? 'slot_game_start_bomb.mp3' : 'slot_game_start.mp3');
            this.nextRound();
        }, intervals.onSelectHints * 1000)
    }


    async parseHintsList(message) {
        message = message.toLocaleLowerCase();
        let foundHints = [];
        let hasBomb = false;
        Object.keys(hintsNames).forEach(hintId => {
            hintsNames[hintId].forEach(hintName => {
                if (foundHints.indexOf(hintId) === -1) {
                   if (message.indexOf(hintName) !== -1) {
                        foundHints.push(hintId);
                    }
                }
            });
        });
        if (foundHints.length >= 3 && foundHints.length <= 5) {
            if (this.timeouts.defaultHints) {
                clearTimeout(this.timeouts.defaultHints);
            }
            bombNames.forEach(bombName => {
                if (message.indexOf(bombName) !== -1) {
                    hasBomb = true;
                }
            });
            this.hasBomb = hasBomb;
            foundHints.forEach(hintId => {
                this.hints[hintId] = {
                    usedAt: null,
                    name: hintsNames[hintId][0],
                    fullName: hintsNames[hintId][1],
                }
            });


            if (foundHints.length === 3) {
                this.safetyNets = [3, 6];
                this.update('safetyNets');
                await this.sendMessage(`Вы выбрали классический вариант игры. Несгораемые суммы установлены на 3 и 6 раунды.`);
                this.setGameState(states.STATE_INGAME_INACTIVE);
                this.onHintsSelected();
            } else {
                if (foundHints.length === 4) {
                    this.setGameState(states.STATE_WAITING_FOR_SAFETY_NET);
                    await this.sendMessage(`Вы выбрали рискованный вариант. Выберите раунд, на который будет установлена несгораемая сумма.`);
                } else {
                    await this.sendMessage(`Вы выбрали экстремальный вариант игры. Несгораемых сумм в этом виде игры нет.`);
                    this.setGameState(states.STATE_INGAME_INACTIVE);
                    this.onHintsSelected();
                }
            }
            this.update('hasBomb');
            this.update('hints');

        } else {
            await this.sendMessage(`Введено некорректное количество подсказок (${foundHints.length}). Их должно быть от 3 до 5.`);
        }
        //this.nextRound();
    }

    saveResults() {
        let results = {
            conversationId: this.conversationId,
            player: {
                id: this.player.id,
                name: this.player.name,
            },
            playerWin: this.state === states.STATE_GAME_WIN,
            playerPass: this.state === states.STATE_PASS,
            sum: this.currentSum,
            maxRound: this.round,
            interactive: this.interactive,
            interactiveNames: this.interactiveNames,
        };
        this.resultsSaver.save(results, this.getSessionName());
    }

    onStart() {
        this.sendMessage([
            'Добро пожаловать',
            'в неофициальный',
            '-=~СВОБОДНЫЙ СЛОТ~=-',
            '',
            'Вся информация по игре: https://vk.com/@safe_slot_bot-welcome',
            'Помимо этой беседы вы можете следить за ходом игры в онлайн-трансляции, которая находится в видеозаписях группы.'
        ])
    }


    onEnd() {
        this.sendMessage([
            '-=~СВОБОДНЫЙ СЛОТ~=-',
            '',
            'Авторы оригинальной игры: Сергей Бойцов, Игорь Черкасов',
            'Музыкальное сопровождение: Дмитрий Яковлев',
            '© 2020'
        ])
    }

    parsePlayerMessage(msg) {
        if (this.state === states.STATE_WAITING_FOR_SAFETY_NET) {
            this.parseSafetyNet(msg);
        }
        if (this.state === states.STATE_WAITING_FOR_HINTS_LIST) {
            this.parseHintsList(msg);
        }
        if (this.state === states.STATE_WAITING_FOR_PLAYER_ANSWER) {
            this.handlePlayerAnswer(msg);
        }
    }
}

module.exports = Game;