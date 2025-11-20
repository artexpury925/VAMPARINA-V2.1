import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

app.use(express.static(__dirname));
app.use(express.json());

// Global
let sock;
const owner = "254703110780@s.whatsapp.net";
const prefix = ".";

// Anti-Delete & Message Store
const deletedMessages = new Map(); // key: messageKey.id → message

// Auto-Status List (Changes every 30 mins)
const autoStatusList = [
    "VAMPARINA V1 Active | .menu",
    "Built by Arnold +254703110780",
    "AI Chatbot: Just chat with me!",
    "120+ Commands | Kenyan Power",
    "Uptime: 24/7 | Katabump Ready",
    "Type .menu for magic",
    "VAMPARINA never sleeps",
    "AI-Powered WhatsApp Bot",
    "Made with love in Kenya"
];
let statusIndex = 0;

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.get('/qr', (req, res) => {
    const file = fs.existsSync('latest_qr.html') ? 'latest_qr.html' : 'pair.html';
    res.sendFile(path.join(__dirname, file));
});

// Start Bot
async function startBot() {
    const sessionId = process.env.SESSION_ID;
    if (!sessionId) {
        console.log("Add SESSION_ID in .env");
        return process.exit();
    }

    const sessionDir = './auth_info';
    fs.ensureDirSync(sessionDir);

    try {
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), Buffer.from(sessionId, 'base64').toString());
    } catch (e) {
        console.log("Invalid SESSION_ID");
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection Update
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("Scan this QR:");
            qrcode.generate(qr, { small: true });
            const qrHtml = await QRCode.toDataURL(qr);
            fs.writeFileSync('latest_qr.html', `
                <center>
                    <h1 style="color:#00ff00">VAMPARINA V1</h1>
                    <img src="${qrHtml}">
                    <br><br>
                    <b>Scan with WhatsApp → Linked Devices</b>
                    <br><small>Owner: Arnold +254703110780</small>
                </center>
            `);
        }

        if (connection === 'open') {
            console.log("VAMPARINA V1 IS ONLINE & READY!");
            startAutoStatus(); // Start auto status
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 5000);
            } else {
                console.log("Logged out. Update SESSION_ID");
            }
        }
    });

    // Store messages for Anti-Delete
    sock.ev.on('messages.upsert', async (m) => {
        for (const msg of m.messages) {
            if (msg.key && msg.message) {
                deletedMessages.set(msg.key.id, msg);
            }
        }
    });

    // Anti-Delete Detection
    sock.ev.on('message-receipt.update', async (updates) => {
        for (const { key, receipt } of updates) {
            if (receipt?.status === 'deleted-for-me' || key.id?.includes('delete')) {
                const deletedMsg = deletedMessages.get(key.id);
                if (deletedMsg && !deletedMsg.key.fromMe) {
                    const sender = deletedMsg.key.participant || deletedMsg.key.remoteJid;
                    const text = deletedMsg.message?.conversation || 
                                deletedMsg.message?.extendedTextMessage?.text || 
                                "[Media or Sticker]";

                    await sock.sendMessage(deletedMsg.key.remoteJid, {
                        text: `*ANTI-DELETE* \n\nFrom: @${sender.split('@')[0]}\nMessage: ${text}`,
                        mentions: [sender]
                    });
                }
            }
        }
    });

    // AI Chatbot (VAMPARINA) + Commands
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const isGroup = from.endsWith('@g.us');

        // AI Chatbot (VAMPARINA) - Reply to any message
        if (!text.startsWith(prefix)) {
            try {
                const response = await fetch(`https://api.yanzapi.com/v1/chat?message=${encodeURIComponent(text)}&name=VAMPARINA`);
                const data = await response.json();
                if (data.result) {
                    await sock.sendMessage(from, { text: data.result });
                }
            } catch (e) {
                // Silent fail – don’t spam on error
            }
            return;
        }

        const args = text.slice(prefix.length).trim().split(/ +/);
        const cmd = args.shift()?.toLowerCase();

        const isOwner = sender === owner;

        try {
            switch (cmd) {
                case 'menu':
                    await sock.sendMessage(from, { text: `*VAMPARINA V1 MENU*\n\nOwner: +254703110780\nPrefix: ${prefix}\n\nAI Chatbot: Just chat!\nAnti-Delete: Active\nAuto-Status: Running\n\n• .ping • .sticker • .quote • .meme\n• .tts hello • .imagine cat\n• .kick @user • .tagall\n• .truth • .dare • .weather Nairobi\n\nTotal: 130+ Features` });
                    break;

                case 'ping':
                    await sock.sendMessage(from, { text: `Pong! ${process.uptime().toFixed(1)}s` });
                    break;

                case 'sticker':
                    if (msg.message.imageMessage || msg.message.videoMessage) {
                        const buffer = await sock.downloadMediaMessage(msg);
                        await sock.sendMessage(from, { sticker: buffer });
                    }
                    break;

                case 'quote':
                    const q = await (await fetch('https://api.quotable.io/random')).json();
                    await sock.sendMessage(from, { text: `*"${q.content}"*\n— ${q.author}` });
                    break;

                case 'meme':
                    const meme = await (await fetch('https://meme-api.com/gimme')).json();
                    await sock.sendMessage(from, { image: { url: meme.url }, caption: meme.title });
                    break;

                case 'tts':
                    const ttsText = args.join(' ');
                    if (ttsText) {
                        await sock.sendMessage(from, { audio: { url: `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(ttsText)}` }, mimetype: 'audio/mpeg', ptt: true });
                    }
                    break;

                case 'imagine':
                    const prompt = args.join(' ');
                    if (prompt) {
                        await sock.sendMessage(from, { text: "Generating image..." });
                        const res = await fetch(`https://api.yanzapi.com/v1/imagine?prompt=${encodeURIComponent(prompt)}`);
                        const json = await res.json();
                        if (json.result) await sock.sendMessage(from, { image: { url: json.result }, caption: `Prompt: ${prompt}` });
                    }
                    break;

                case 'kick':
                    if (from.endsWith('@g.us') && isOwner) {
                        const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (users.length) await sock.groupParticipantsUpdate(from, users, 'remove');
                    }
                    break;

                case 'tagall':
                    if (from.endsWith('@g.us')) {
                        const metadata = await sock.groupMetadata(from);
                        let text = "Everyone!\n\n";
                        metadata.participants.forEach(p => text += `@${p.id.split('@')[0]}\n`);
                        await sock.sendMessage(from, { text, mentions: metadata.participants.map(p => p.id) });
                    }
                    break;

                case 'restart':
                    if (isOwner) {
                        await sock.sendMessage(from, { text: "Restarting VAMPARINA..." });
                        process.exit(1);
                    }
                    break;

                default:
                    await sock.sendMessage(from, { text: "Unknown command. Use .menu" });
            }
        } catch (e) {
            console.log("Error:", e);
        }
    });

    // Welcome Message
    sock.ev.on('group-participants.update', async (update) => {
        if (update.action === 'add') {
            const user = update.participants[0];
            await sock.sendMessage(update.id, { 
                text: `Welcome @${user.split('@')[0]}!\n\nI'm *VAMPARINA*, your AI assistant.\nJust chat with me or type .menu`, 
                mentions: [user] 
            });
        }
    });
}

// Auto-Status Changer
function startAutoStatus() {
    setInterval(async () => {
        if (!sock?.user) return;
        try {
            await sock.sendMessage(sock.user.id, { text: autoStatusList[statusIndex] });
            statusIndex = (statusIndex + 1) % autoStatusList.length;
        } catch (e) {}
    }, 30 * 60 * 1000); // Every 30 minutes
}

startBot();

app.listen(PORT, () => {
    console.log(`VAMPARINA V1 Running on port ${PORT}`);
    console.log(`Visit /qr to see QR code`);
});