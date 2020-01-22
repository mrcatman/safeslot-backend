const fs = require('fs');
const storagePath = 'src/storage/results';

class ResultsSaver {

    constructor() {
        this.sessionResults = [];
    }

    async save(results, session) {
        let ts = new Date().getTime();
        fs.writeFile(storagePath + '/results-'+ts+'.json', JSON.stringify(results), () => {})
        if (session) {
            let sessionPath = storagePath + '/sessions/session-'+session+'.json';
            if (!this.sessionResults[session] && fs.existsSync(sessionPath)) {
                this.sessionResults[session] = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
            }
            if (!this.sessionResults[session]) {
                this.sessionResults[session] = {
                    players: [],
                    interactive: {}
                };
            }
            let sessionResult = JSON.parse(JSON.stringify(results));
            let interactive = JSON.parse(JSON.stringify(sessionResult.interactive));
            sessionResult.interactive = undefined;
            this.sessionResults[session].players.push(sessionResult);
            Object.keys(interactive).forEach(interactiveUserId => {
                if (!this.sessionResults[session].interactive[interactiveUserId]) {
                    this.sessionResults[session].interactive[interactiveUserId] = 0;
                }
                this.sessionResults[session].interactive[interactiveUserId] += interactive[interactiveUserId];
            });
             fs.writeFile(sessionPath, JSON.stringify( this.sessionResults[session]), () => {})
        }
    }

    getResults(session) {
        let sessionPath = storagePath + '/sessions/session-'+session+'.json';
        if (fs.existsSync(sessionPath)) {
            let data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
            return data;
        } else {
            return {};
        }
    }


    getAllResults() {
        let sessionPath = storagePath + '/sessions/';
        let files = fs.readdirSync(sessionPath);
        let results = {
            players: [],
            interactive: {},
            interactiveNames: {}
        };
       for (let index in files) {
            let file = files[index];
            let contents = fs.readFileSync(sessionPath + file, 'utf8');
            let data = JSON.parse(contents);
            if (data.players) {
                results.players = [...results.players, ...data.players];
            }
            if (data.interactive) {
                results.interactive = {...results.interactive, ...data.interactive};
            }
            if (data.interactiveNames) {
                results.interactiveNames = {...results.interactiveNames, ...data.interactiveNames};
            }
        }
        return results;
    }

}

module.exports = ResultsSaver;