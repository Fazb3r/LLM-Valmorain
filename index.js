require('dotenv').config();
const { Client, GatewayIntentBits, Partials, MessageType } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.once('ready', () => {
    console.log(`[READY] Valmorain logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    // 1. Ignore messages from bots (including ourselves)
    if (message.author.bot) return;

    // 2. Addressing Detection
    
    // Check if the bot was directly mentioned
    const isMentioned = message.mentions.has(client.user.id);
    
    // Check if the message is a direct reply to the bot
    const isReply = message.type === MessageType.Reply && message.mentions.repliedUser?.id === client.user.id;
    
    // Check if named in text
    const textContent = message.content.toLowerCase();
    
    // Allow repeated characters for emphasis (e.g. "Valmorainnn", "valllmo", "vallll")
    // \b word boundaries ensure we don't accidentally match "valo" or "valorant"
    const nameRegex = /\b(v+a+l+m+o+r+a+i*n+|v+a+l+m+o+|v+a+l+)\b/i;
    let isNamed = nameRegex.test(textContent);

    // 3. Autonomous interjection
    // Valmorain has a small chance (e.g., 3%) to interject on random active conversations 
    // to feel more natural, provided the message has some substance (> 10 characters).
    const isAutonomous = Math.random() < 0.03 && textContent.length > 10;

    // If none of the conditions are met, Valmorain simply listens (ignores the message).
    if (!isMentioned && !isReply && !isNamed && !isAutonomous) {
        return;
    }

    // --- Valmorain decides to process this message ---
    
    try {
        // Show typing indicator to feel more natural and responsive
        await message.channel.sendTyping();

        // Send the message to the local Ollama instance
        const response = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'Valmorain', // This must match the name of the model you created in Ollama
                messages: [{ role: 'user', content: message.content }],
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error! status: ${response.status}`);
        }

        const data = await response.json();
        const replyContent = data.message.content;

        // If she was directly tagged or replied to, use the Discord reply function
        // Otherwise, send the message freely to the channel
        if (isMentioned || isReply) {
            await message.reply({ content: replyContent });
        } else {
            await message.channel.send({ content: replyContent });
        }

    } catch (error) {
        console.error("Error processing message with Ollama:", error);
        const errorMsg = "*(I am currently unable to reach my thoughts... Is Ollama running?)*";
        if (isMentioned || isReply) {
            await message.reply({ content: errorMsg });
        } else {
            await message.channel.send({ content: errorMsg });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
