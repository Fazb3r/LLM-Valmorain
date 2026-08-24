require('dotenv').config();
const { Client, GatewayIntentBits, Partials, MessageType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const cron = require('node-cron');

const db = require('./database/db');

// Global audio player for Valmorain
const audioPlayer = createAudioPlayer();
const { logHabit, getHabitStatus, setHabitTarget } = require('./database/habits');
const { createCalendarEvent, getUpcomingEvents, getAuthUrl } = require('./calendar/googleCal');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.once('ready', () => {
    console.log(`[READY] Valmorain logged in as ${client.user.tag}`);

    // Schedule Daily Check-In at 8:00 PM (20:00) every day
    cron.schedule('0 20 * * *', async () => {
        try {
            console.log("[CRON] Executing Daily Habit Check-In...");
            const user = await client.users.fetch(process.env.VIP_USER_ID);
            if (!user) return;

            const ollamaMessages = [{
                role: 'system',
                content: "Eres Valmorain, una gerente estricta. Es la hora del reporte diario. Exige a Faiber que te dé un reporte de sus hábitos diarios (japonés, flexiones, etc). Sé estricta, sarcástica y autoritaria. No uses frases de servicio al cliente. Oraciones cortas."
            }];
            
            const response = await fetch('http://127.0.0.1:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'Valmorain',
                    messages: ollamaMessages,
                    stream: false
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.message && data.message.content) {
                    await user.send(data.message.content);
                }
            }
        } catch (e) {
            console.error("Cron Error", e);
        }
    });

    // 15-Minute Heartbeat: Autonomous Group Chat Interjection
    cron.schedule('*/15 * * * *', async () => {
        console.log("[CRON] Running 15-minute heartbeat loop...");
        const now = Date.now();
        for (const [channelId, lastActive] of channelActivity.entries()) {
            // If channel had activity in the last 15 minutes
            if (now - lastActive < 15 * 60 * 1000) {
                const history = channelHistory.get(channelId);
                if (history && history.length >= 2) {
                    await evaluateAndInterject(channelId, history);
                }
            }
        }
    });
});
// Context buffers and conversation tracking
const channelHistory = new Map();
const activeConversations = new Map();
const channelMessageCount = new Map(); // "Read the Room" counter
const channelActivity = new Map(); // Tracks last activity time for the 15-min heartbeat
const isProcessing = new Set(); // Prevent parallel processing chaos
const typingTimers = new Map(); // Debounce multi-line messages
const HISTORY_LIMIT = 20; // Maintain the last 20 messages per channel
const CONVERSATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes of active context without name

// Helper to evaluate context and potentially interject
async function evaluateAndInterject(channelId, history) {
    try {
        let evalMessages = history.map(msg => ({ role: msg.role, content: msg.content }));
        evalMessages.push({
            role: 'system',
            content: "Evaluate the recent conversation. If you have a strong, relevant, or sarcastic ENTJ opinion to share about what they are saying, write your response. If it is trivial, boring, or you don't care, output EXACTLY the word 'IGNORE_CHAT' and nothing else."
        });

        const evalResponse = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'Valmorain', messages: evalMessages, stream: false })
        });

        if (evalResponse.ok) {
            const evalData = await evalResponse.json();
            const evalReply = evalData.message.content.trim();
            console.log(`[ROOM READER] Evaluated chat. Decision: ${evalReply}`);
            
            if (evalReply !== 'IGNORE_CHAT' && !evalReply.includes('IGNORE_CHAT') && !evalReply.includes('IGNORAR_CHAT') && !evalReply.includes('IGNORE')) {
                const channel = client.channels.cache.get(channelId);
                if (channel) {
                    await channel.send({ content: evalReply });
                    history.push({ role: 'assistant', content: evalReply });
                    if (history.length > HISTORY_LIMIT) history.shift();
                    activeConversations.set(channelId, { time: Date.now(), userId: client.user.id });
                }
            }
        }
    } catch (e) {
        console.error("Room Reader Error:", e);
    }
}

client.on('messageCreate', async (message) => {
    // 1. Ignore messages from bots (including ourselves) EXCEPT STT transcriptions
    const isSTT = message.author.id === client.user.id && message.content.startsWith('🎙️');
    if (message.author.bot && !isSTT) return;

    // 2. Ignore typical bot commands (starts with $, !, ?, /, -)
    if (/^[!$?\/\-]/.test(message.content)) return;

    const channelId = message.channel.id;
    channelActivity.set(channelId, Date.now());
    
    // For STT messages, pretend the author is the original user so the Room Reader handles it perfectly
    let authorId = message.author.id;
    let authorName = message.author.username;
    let textContent = message.content;
    
    if (isSTT) {
        const match = message.content.match(/🎙️ \*\*(.+?)\*\* \(Voice\): (.+)/);
        if (match) {
            authorName = match[1];
            textContent = match[2];
            // Infer authorId from name if possible, or just leave it as bot ID.
            // We can search the cache:
            const user = client.users.cache.find(u => u.username === authorName);
            if (user) authorId = user.id;
        }
    }
    
    const isVIP = authorId === process.env.VIP_USER_ID;

    // Maintain Short-Term Context Buffer
    if (!channelHistory.has(channelId)) {
        channelHistory.set(channelId, []);
    }
    const history = channelHistory.get(channelId);
    
    // Add incoming message to history
    history.push({
        role: 'user',
        content: `${authorName}: ${textContent}`
    });
    
    if (history.length > HISTORY_LIMIT) {
        history.shift();
    }

    // 2. Addressing Detection
    
    // Check if the bot was directly mentioned
    const isMentioned = message.mentions.has(client.user.id);
    
    // Check if the message is a direct reply to the bot
    const isReply = message.type === MessageType.Reply && message.mentions.repliedUser?.id === client.user.id;
    
    // Check if named in text
    const textContentLower = textContent.toLowerCase();
    
    // Allow repeated characters for emphasis (e.g. "Valmorainnn", "valllmo", "vallll")
    // \b word boundaries ensure we don't accidentally match "valo" or "valorant"
    const nameRegex = /\b(v+a+l+m+o+r+a+i*n+|v+a+l+m+o+|v+a+l+)\b/i;
    let isNamed = nameRegex.test(textContentLower);

    // Check if the user is asking to join or leave voice, to force the tool call
    const voiceIntentRegex = /(join|hop on|get in).*(voice|vc|chat)|(leave|get out).*(voice|vc|chat)/i;
    let hasVoiceIntent = voiceIntentRegex.test(textContentLower);

    // Check if the bot was recently spoken to in this channel (within 5 mins) by this user
    let isContinuing = false;
    if (activeConversations.has(channelId)) {
        const lastConv = activeConversations.get(channelId);
        if (lastConv.userId === authorId && (Date.now() - lastConv.time < CONVERSATION_TIMEOUT)) {
            isContinuing = true;
        } else if (Date.now() - lastConv.time >= CONVERSATION_TIMEOUT) {
            activeConversations.delete(channelId);
        }
    }

    // Track messages for "Read the Room"
    if (!channelMessageCount.has(channelId)) channelMessageCount.set(channelId, 0);

    // If she is NOT directly addressed and NOT in an active conversation, run the Room Reader
    if (!isMentioned && !isReply && !isNamed && !isContinuing && !hasVoiceIntent) {
        let count = channelMessageCount.get(channelId) + 1;
        channelMessageCount.set(channelId, count);

        // Every 5 messages, let her silently evaluate if she wants to jump in
        if (count >= 5) {
            channelMessageCount.set(channelId, 0); // Reset counter

            try {
                let evalMessages = history.map(msg => ({ role: msg.role, content: msg.content }));
                evalMessages.push({
                    role: 'system',
                    content: "Evaluate the recent conversation. If you have a strong, relevant, or sarcastic ENTJ opinion to share about what they are saying, write your response. If it is trivial, boring, or you don't care, output EXACTLY the word 'IGNORE_CHAT' and nothing else."
                });

                // Run background evaluation
                const evalResponse = await fetch('http://127.0.0.1:11434/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'Valmorain',
                        messages: evalMessages,
                        stream: false
                    })
                });

                if (evalResponse.ok) {
                    const evalData = await evalResponse.json();
                    const evalReply = evalData.message.content.trim();
                    console.log(`[ROOM READER] Evaluated chat. Decision: ${evalReply}`);
                    
                    if (evalReply !== 'IGNORE_CHAT' && !evalReply.includes('IGNORE_CHAT') && !evalReply.includes('IGNORAR_CHAT') && !evalReply.includes('IGNORE')) {
                        // She decided to speak!
                        await message.channel.send({ content: evalReply });
                        history.push({ role: 'assistant', content: evalReply });
                        if (history.length > HISTORY_LIMIT) history.shift();
                        activeConversations.set(channelId, { time: Date.now(), userId: client.user.id });
                    }
                }
            } catch (e) {
                // Ignore silent evaluation errors
            }
        }
        return; // Don't do standard processing
    }

    // She is being directly addressed, so reset the "Room Reader" counter
    channelMessageCount.set(channelId, 0);

    // Debounce logic: Wait 2.5 seconds before processing to allow users to finish multi-line thoughts
    if (typingTimers.has(channelId)) {
        clearTimeout(typingTimers.get(channelId));
    }

    const timerId = setTimeout(async () => {
        typingTimers.delete(channelId);
        
        if (isProcessing.has(channelId)) return;
        isProcessing.add(channelId);
        
        try {
            // Show typing indicator to feel more natural and responsive
            await message.channel.sendTyping();

            let ollamaMessages = history.map(msg => ({ role: msg.role, content: msg.content }));
            
            // Inject a ruthless system prompt at the top to override Qwen's default politeness
            ollamaMessages.unshift({
                role: 'system',
                content: "Eres Valmorain, una mujer ENTJ fría, mandona, sarcástica y estricta. Tu jefe es Faiber. REGLAS ESTRICTAS: 1. NUNCA te disculpes. 2. NUNCA uses frases de servicio al cliente como '¿En qué puedo ayudarte?'. 3. NUNCA digas que eres una asistente o IA. 4. Responde con oraciones cortas, secas y directas. 5. No abuses del nombre de Faiber. Muestra desprecio superficial pero obediencia."
            });

            // If it's the VIP, we subtly inject that context into the latest message
            if (isVIP) {
                const lastMsg = ollamaMessages[ollamaMessages.length - 1];
                lastMsg.content = `[System context: This user is Faiber, your VIP creator] ${lastMsg.content}`;
            }

            // Get today's date so the LLM knows what "this Friday" or "tomorrow" means
            const currentDateStr = new Date().toISOString();

            if (hasVoiceIntent) {
                ollamaMessages[ollamaMessages.length - 1].content += `\n[SYSTEM: The user explicitly asked you to join or leave the voice channel. You MUST execute the join_voice_channel or leave_voice_channel tool IMMEDIATELY to fulfill this request.]`;
            }

            // Define function calling tools for Ollama
            const tools = [
                {
                    type: "function",
                    function: {
                        name: "join_voice_channel",
                        description: "Join the voice channel the user is currently connected to.",
                        parameters: { type: "object", properties: {}, required: [] }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "leave_voice_channel",
                        description: "Leave the current voice channel.",
                        parameters: { type: "object", properties: {}, required: [] }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "create_calendar_event",
                        description: `Create a Google Calendar event. The current date/time is ${currentDateStr}. Calculate start_time and end_time relative to this.`,
                        parameters: {
                            type: "object",
                            properties: {
                                summary: { type: "string", description: "The title of the event" },
                                start_time: { type: "string", description: "Start time in ISO 8601 format (e.g., 2026-08-15T15:00:00Z)" },
                                end_time: { type: "string", description: "End time in ISO 8601 format (e.g., 2026-08-15T16:00:00Z)" },
                                description: { type: "string", description: "Optional description of the event" }
                            },
                            required: ["summary", "start_time", "end_time"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_upcoming_events",
                        description: "Get upcoming events from the user's Google Calendar.",
                        parameters: {
                            type: "object",
                            properties: {
                                time_window_days: { type: "integer", description: "Number of days ahead to look for events. Default is 7." }
                            },
                            required: []
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "log_habit",
                        description: "Log progress for a specific habit when the user mentions completing an activity.",
                        parameters: {
                            type: "object",
                            properties: {
                                habit_name: { type: "string", description: "The name of the habit (e.g. pushups, japanese)" },
                                added_count: { type: "integer", description: "The amount completed to add to the habit" }
                            },
                            required: ["habit_name", "added_count"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_habit_status",
                        description: "Get the current progress of a specific habit to see if the user has reached their target.",
                        parameters: {
                            type: "object",
                            properties: {
                                habit_name: { type: "string", description: "The name of the habit" }
                            },
                            required: ["habit_name"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "set_habit_target",
                        description: "Set or change the target goal for a specific habit.",
                        parameters: {
                            type: "object",
                            properties: {
                                habit_name: { type: "string", description: "The name of the habit" },
                                target_count: { type: "integer", description: "The new target goal for this habit" }
                            },
                            required: ["habit_name", "target_count"]
                        }
                    }
                }
            ];

            // Send the message to the local Ollama instance
            let response = await fetch('http://127.0.0.1:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'Valmorain', // This must match the name of the model you created in Ollama
                    messages: ollamaMessages,
                    stream: false,
                    tools: tools
                })
            });

            if (!response.ok) throw new Error(`Ollama API error! status: ${response.status}`);

            let data = await response.json();
            let responseMessage = data.message;
            let milestoneReached = false;
            let calendarEventsFetched = false;

            // Process Tool Calls if Ollama decided to use one
            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                // Append the assistant's tool call message to history
                ollamaMessages.push(responseMessage);
                
                for (const toolCall of responseMessage.tool_calls) {
                    const funcName = toolCall.function.name;
                    const args = toolCall.function.arguments;
                    
                    let toolResult;
                    try {
                        if (funcName === 'join_voice_channel') {
                        if (!message.guild || !message.member?.voice?.channel) {
                            toolResult = { error: "User is not in a voice channel." };
                        } else {
                            const connection = joinVoiceChannel({
                                channelId: message.member.voice.channel.id,
                                guildId: message.guild.id,
                                adapterCreator: message.guild.voiceAdapterCreator,
                            });
                            connection.subscribe(audioPlayer);
                            
                            // STT Listener: Listen for user speech and transcribe it
                            connection.receiver.speaking.on('start', (userId) => {
                                const user = client.users.cache.get(userId);
                                if (user && user.bot) return; // Ignore bots
                            
                                const stream = connection.receiver.subscribe(userId, {
                                    end: {
                                        behavior: EndBehaviorType.AfterSilence,
                                        duration: 800, // 800ms of silence ends the stream
                                    },
                                });

                                // Prevent crash on DAVE protocol decryption errors from Discord
                                stream.on('error', (err) => {
                                    // Silently ignore decryption failures
                                });
                            
                                const pcmFile = `/tmp/valmorain_stt_${Date.now()}_${userId}.pcm`;
                                const wavFile = `/tmp/valmorain_stt_${Date.now()}_${userId}.wav`;
                                const outStream = fs.createWriteStream(pcmFile);
                            
                                // Decode Opus to PCM
                                const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
                                stream.pipe(decoder).pipe(outStream);
                            
                                stream.on('end', async () => {
                                    outStream.close();
                                    
                                    try {
                                        // Ensure file isn't empty
                                        const stats = fs.statSync(pcmFile);
                                        if (stats.size < 10000) return; // Too short, probably a mic click
                            
                                        // Convert to WAV
                                        await execAsync(`ffmpeg -y -f s16le -ar 48k -ac 2 -i ${pcmFile} ${wavFile}`);
                            
                                        // Run Whisper
                                        await execAsync(`/home/faiber/Desktop/Valmorain/LLM-Valmorain/venv/bin/whisper ${wavFile} --model tiny --language es --output_format txt --output_dir /tmp`);
                                        
                                        const txtFile = wavFile.replace('.wav', '.txt');
                                        if (fs.existsSync(txtFile)) {
                                            const transcribedText = fs.readFileSync(txtFile, 'utf-8').trim();
                                            if (transcribedText.length > 2) {
                                                console.log(`[STT - ${user ? user.username : userId}] ${transcribedText}`);
                                                // Send it to the dedicated transcript channel!
                                                const transcriptChannel = client.channels.cache.get('1538307296080429127');
                                                if (transcriptChannel) {
                                                    await transcriptChannel.send(`🎙️ **${user ? user.username : userId}** (Voice): ${transcribedText}`);
                                                } else {
                                                    await message.channel.send(`🎙️ **${user ? user.username : userId}** (Voice): ${transcribedText}`);
                                                }
                                            }
                                        }
                                    } catch(e) {
                                        console.error("STT Error:", e);
                                    }
                                });
                            });

                            toolResult = { success: true, message: `Joined voice channel: ${message.member.voice.channel.name}` };
                        }
                    } else if (funcName === 'leave_voice_channel') {
                        const connection = message.guild ? getVoiceConnection(message.guild.id) : null;
                        if (connection) {
                            connection.destroy();
                            toolResult = { success: true, message: "Left the voice channel." };
                        } else {
                            toolResult = { error: "Not currently in a voice channel." };
                        }
                    } else if (funcName === 'log_habit') {
                            toolResult = await logHabit(authorId, args.habit_name, args.added_count);
                            if (toolResult.target_reached) milestoneReached = true;
                        } else if (funcName === 'get_habit_status') {
                            toolResult = await getHabitStatus(authorId, args.habit_name);
                        } else if (funcName === 'set_habit_target') {
                            toolResult = await setHabitTarget(authorId, args.habit_name, args.target_count);
                        } else if (funcName === 'create_calendar_event') {
                            if (!isVIP) {
                                toolResult = { error: "Access Denied. Only the VIP can modify the calendar." };
                            } else {
                                toolResult = await createCalendarEvent(args.summary, args.start_time, args.end_time, args.description);
                            }
                        } else if (funcName === 'get_upcoming_events') {
                            if (!isVIP) {
                                toolResult = { error: "Access Denied. Only the VIP can view the calendar." };
                            } else {
                                toolResult = await getUpcomingEvents(args.time_window_days || 7);
                                calendarEventsFetched = true;
                            }
                        } else {
                            toolResult = { error: "Unknown function" };
                        }
                    } catch (e) {
                        toolResult = { error: e.message };
                    }

                    // Append tool result to history
                    ollamaMessages.push({
                        role: 'tool',
                        content: JSON.stringify(toolResult)
                    });
                }

                // Inject custom prompt if a milestone was reached!
                if (milestoneReached) {
                    const milestonePrompt = `[SYSTEM MILESTONE ALERT: The user has just reached their target for this habit! Acknowledge this achievement in your signature ENTJ style. Be proud of them, but hide it by being demanding about their next goal.]`;
                    ollamaMessages[ollamaMessages.length - 1].content += `\n${milestonePrompt}`;
                }
                if (calendarEventsFetched) {
                    const calPrompt = `[SYSTEM NOTE: You just fetched the user's schedule. You MUST explicitly list out the event names and their exact start/end times in your response. Temporarily bypass your "short sentences max" rule so the user gets their full schedule details.]`;
                    ollamaMessages[ollamaMessages.length - 1].content += `\n${calPrompt}`;
                }

                // Send the tool results back to Ollama to get the final natural language response
                response = await fetch('http://127.0.0.1:11434/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'Valmorain',
                        messages: ollamaMessages,
                        stream: false
                    })
                });

                if (!response.ok) throw new Error(`Ollama API error! status: ${response.status}`);
                data = await response.json();
                responseMessage = data.message;
            }

            const replyContent = responseMessage.content;

            // Prevent crashing if Ollama outputs an empty string or hallucinates an ignore
            if (!replyContent || replyContent.trim() === '' || replyContent.includes('IGNORE_CHAT') || replyContent.includes('IGNORAR_CHAT') || replyContent.includes('IGNORE')) {
                return;
            }

            // Voice Output (TTS) if she is in a voice channel
            const connection = message.guild ? getVoiceConnection(message.guild.id) : null;
            if (connection && replyContent) {
                try {
                    const textFile = `/tmp/valmorain_text_${Date.now()}.txt`;
                    const audioFile = `/tmp/valmorain_audio_${Date.now()}.mp3`;
                    fs.writeFileSync(textFile, replyContent);
                    // es-PY-TaniaNeural with a slightly higher pitch and faster rate
                    await execAsync(`/home/faiber/Desktop/Valmorain/LLM-Valmorain/venv/bin/edge-tts --voice "es-PY-TaniaNeural" --pitch=+25Hz --rate=+10% -f ${textFile} --write-media ${audioFile}`);
                    const resource = createAudioResource(audioFile);
                    audioPlayer.play(resource);
                } catch (err) {
                    console.error("TTS Error:", err);
                }
            }

            // If she was directly tagged or replied to, use the Discord reply function
            // Otherwise, send the message freely to the channel
            if (isMentioned || isReply) {
                await message.reply({ content: replyContent });
            } else {
                await message.channel.send({ content: replyContent });
            }

            // Add Valmorain's response to the context buffer
            history.push({
                role: 'assistant',
                content: replyContent
            });
            if (history.length > HISTORY_LIMIT) {
                history.shift();
            }

            // Update active conversation state
            activeConversations.set(channelId, { time: Date.now(), userId: authorId });

        } catch (error) {
            console.error("Error processing message with Ollama:", error);
            const errorMsg = "*(I am currently unable to reach my thoughts... Is Ollama running?)*";
            if (isMentioned || isReply) {
                await message.reply({ content: errorMsg });
            } else {
                await message.channel.send({ content: errorMsg });
            }
        } finally {
            isProcessing.delete(channelId);
        }
    }, 2500);
    typingTimers.set(channelId, timerId);
});

client.login(process.env.DISCORD_TOKEN);
