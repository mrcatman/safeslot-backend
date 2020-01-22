const fs = require('fs');
const storagePath = 'src/storage/aliases.json';

class AliasesHandler {

    constructor() {
        if (fs.existsSync(storagePath)) {
            this.aliases = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
            if (!this.aliases) {
                this.aliases = {};
            }
        } else {
            this.aliases = {};
        }
    }

    set(userId, alias) {
        this.aliases[userId] = alias;
        fs.writeFile(storagePath, JSON.stringify(this.aliases), () => {})
    }

    get(userId) {
        return this.aliases[userId] ? this.aliases[userId] : null;
    }
}

module.exports = AliasesHandler;