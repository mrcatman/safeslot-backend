
class DiscordClient {

    constructor(client) {
        this.type = 'discord';
        this.voiceConnections = [];
        this.dispatchers = [];
        this.client = client;
    }

    async getChannel(conversationId) {
        let channel = await this.client.channels.get(conversationId);
        return channel;
    }

    async getUsers(conversationId) {
        let channel = await this.getChannel(this.getTextId(conversationId));
        if (!channel) {
            return [];
        }
        return channel.guild.members.array().filter(member => {
            return !member.user.bot;
        }).map(member => {
            return {
                id: member.user.id,
                username: member.user.username,
            }
        });
    }

    getTextId(conversationId) {
        let splitted = conversationId.trim().split(";")
        return splitted[0];
    }

    getAudioId(conversationId) {
        let splitted = conversationId.trim().split(";")
        return splitted[1];
    }

    async sendMessage(message, conversationId) {
        //message = '```'+message+'```';
        return await this.client.channels.get(this.getTextId(conversationId)).send(message);
    }

    async listConferences() {
        let allConversations = await this.client.guilds.map(guild => {
            return guild.channels.filter(channel => (channel.type === 'text' || channel.type === 'voice')).map(channel => {
                return `[${channel.type}] ${channel.name} (ID: ${channel.id}, сервер: ${guild.name}) \n`;
            });
        });
        return allConversations;
    }

    mention(user) {
        return `<@${user.id}>`;
    }

    async joinAdditionalChannel(conversationId) {
        let voiceChannelId = this.getAudioId(conversationId);
        if (voiceChannelId) {
            let channel = await this.getChannel(voiceChannelId);
            if (channel) {
                this.voiceConnections[voiceChannelId] = await channel.join();
            }
        }
    }
    playTrack(conversationId, name) {
        let voiceChannelId = this.getAudioId(conversationId);
        if (!voiceChannelId) return;
        if (this.voiceConnections[voiceChannelId]) {
            let filename = `/home/bot/static/tracks/${name}`;
            if (this.dispatchers[voiceChannelId]) {
                this.dispatchers[voiceChannelId].pause();
                this.dispatchers[voiceChannelId] = this.voiceConnections[voiceChannelId].playFile(filename);
                this.dispatchers[voiceChannelId].resume();
            } else {
                this.dispatchers[voiceChannelId] = this.voiceConnections[voiceChannelId].playFile(filename);
            }
            console.log('playing', filename);
        }
    }

    async getUserById(id) {
        let user = await this.client.fetchUser(id);
        return user;
    }
    async getConversationById(id) {
        let chat = await this.client.channels.get(this.getTextId(id));
        if (!chat) {
            return null;
        }
        return chat;
    }

    async onLeave(conversationId) {
        let voiceChannelId = this.getAudioId(conversationId);
        if (!voiceChannelId) return;
        if (this.voiceConnections[voiceChannelId]) {
            let channel = this.getChannel(voiceChannelId);
            if (channel) {
                channel.leave();
            }
        }
    }
}

module.exports = DiscordClient;