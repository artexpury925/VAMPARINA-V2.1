import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
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

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.get('/qr', (req, res) => {
    const file = fs.existsSync('latest_qr.html') ? 'latest_qr.html' : 'pair.html';
    res.sendFile(path.join(__dirname, file));
});

// Pairing Route
app.get('/pair', (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("Enter code: <input><button onclick=\"location.href='/pair?code='+this.previousElementSibling.value\">Pair</button>");
    res.send(`<h2>Pairing ${code}...</h2><script>fetch('/pair?code='+${code})</script>`);
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
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("Scan QR:");
            qrcode.generate(qr, { small: true });
            const qrHtml = await QRCode.toDataURL(qr);
            fs.writeFileSync('latest_qr.html', `<center><h1>VAMPARINA V1</h1><img src="${qrHtml}"><br><small>Scan with WhatsApp → Linked Devices</small></center>`);
        }

        if (connection === 'open') {
            console.log("VAMPARINA V1 IS ONLINE!");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    // Message Handler
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const args = text.slice(prefix.length).trim().split(/ +/);
        const cmd = args.shift()?.toLowerCase();

        if (!text.startsWith(prefix)) return;

        const isOwner = sender === owner || msg.key.fromMe;

        try {
            switch (cmd) {
                case 'menu':
                    await sock.sendMessage(from, { text: `*VAMPARINA V1 MENU*\n\nOwner: +254703110780\nPrefix: ${prefix}\n\n• .ping • .sticker • .quote • .meme\n• .tts hello • .imagine cat\n• .kick @user • .tagall\n• .truth • .dare • .weather Nairobi\n• .song shape of you\n• .tt link • .ig link\n\nTotal: 120+ Commands` });
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
                        await sock.sendMessage(from, { text: "Generating..." });
                        const res = await fetch(`https://api.yanzapi.com/v1/imagine?prompt=${encodeURIComponent(prompt)}`);
                        const json = await res.json();
                        if (json.result) await sock.sendMessage(from, { image: { url: json.result } });
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
                        await sock.sendMessage(from, { text: "Restarting..." });
                        process.exit(1);
                    }
                    break;

                default:
                    await sock.sendMessage(from, { text: "Unknown command. Use .menu" });
            }
        } catch (e) {
            console.log(e);
        }
    });

    // Welcome Message
    sock.ev.on('group-participants.update', async (update) => {
        if (update.action === 'add') {
            const user = update.participants[0];
            await sock.sendMessage(update.id, { text: `Welcome @${user.split('@')[0]}! Use .menu`, mentions: [user] });
        }
    });
}

startBot();

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Visit /qr to see QR code`);
});