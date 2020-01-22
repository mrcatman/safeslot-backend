const vkApiRequest = require('../apiRequest');

class VkClient {

    constructor() {
        this.type = 'vk';
    }

    async getUsers(conversationId) {
        let res = await vkApiRequest("messages.getConversationMembers", {peer_id: conversationId});
        return res.response.profiles;
    }

    async sendMessage(message, conversationId) {
        let random_id = Math.ceil(Math.random() * 1000000000);
        return await vkApiRequest("messages.send", {
            random_id: random_id,
            peer_id: conversationId,
            message
        });
    }

    async listConferences() {
        let allConversations = await vkApiRequest("messages.getConversations", {count: 50});
        return allConversations.response.items.filter(item => item.conversation.peer.type === 'chat').map(conference => {
            return `${conference.conversation.chat_settings.title} (ID: ${conference.conversation.peer.id})`
        })
    }

    mention(user) {
        return `@id${user.id}(${user.name})`;
    }

    async getUserById(id) {
        let user = await vkApiRequest("users.getConversationMembers", {user_ids: id, fields: "photo_100"});
        return user;
    }

    async getConversationById(id) {
        let chat = await vkApiRequest("messages.getConversationsById", {peer_ids: id});
        if (chat.error || !chat.response.items[0]) {
            return null;
        }
        let data = chat.response.items[0].chat_settings;
        data.name = data.title;
        return data;
    }
}

module.exports = VkClient;