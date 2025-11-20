import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

// Your routes
import pairRouter from './pair.js';
import qrRouter from './qr.js';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

// Global variables
let sock;
const owner = "254703110780@s.whatsapp.net";
const prefix = ".";
let welcomeMsg = "Welcome @user! Use .menu to see commands";

// Start WhatsApp Bot
async function startBot() {
    const sessionId = process.env.SESSION_ID;
    if (!sessionId) {
        console.log("SESSION_ID not found in .env! Add it to deploy.");
        return;
    }

    const authDir = `./session_${Date.now()}`;
    fs.ensureDirSync(authDir);

    // Decode SESSION_ID
    const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
    fs.writeFileSync(path.join(authDir, 'creds.json'), decoded);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Scan QR below:');
            qrcode.generate(qr, { small: true });
            const qrHtml = await QRCode.toDataURL(qr);
            fs.writeFileSync('latest_qr.html', `<img src="${qrHtml}">`);
        }

        if (connection === 'open') {
            console.log('VAMPARINA V1 CONNECTED! +254703110780');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            if (shouldReconnect) {
                console.log('Reconnecting...');
                setTimeout(startBot, 5000);
            } else {
                console.log('Session expired. Update SESSION_ID');
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || from;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const args = text.slice(prefix.length).trim().split(/ +/);
        const cmd = args.shift()?.toLowerCase();

        if (!text.startsWith(prefix)) return;

        // Owner only
        const isOwner = sender === owner || msg.key.fromMe;

        try {
            switch (cmd) {
                case 'menu': case 'help':
                    await sock.sendMessage(from, { text: `*VAMPARINA V1 MENU*\n\n` +
                        `Owner: Arnold +254703110780\n` +
                        `Prefix: ${prefix}\n\n` +
                        `General: ping, time, sticker, quote, meme\n` +
                        `Media: tts, song, video, ig, fb, tt\n` +
                        `AI: gpt, imagine, sora\n` +
                        `Admin: kick, ban, promote, tagall\n` +
                        `Fun: truth, dare, simp, insult, ship\n` +
                        `Games: ttt, hangman, trivia\n` +
                        `More: weather, news, crypto, github\n\n` +
                        `Total Commands: 120+` });
                    break;

                case 'ping':
                    await sock.sendMessage(from, { text: `Pong! ${process.uptime().toFixed(1)}s` });
                    break;

                case 'sticker': case 's':
                    if (msg.message.imageMessage || msg.message.videoMessage) {
                        const buffer = await sock.downloadMediaMessage(msg);
                        await sock.sendMessage(from, { sticker: buffer });
                    }
                    break;

                case 'kick':
                    if (!isGroup || !isOwner) break;
                    const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    if (users.length) await sock.groupParticipantsUpdate(from, users, 'remove');
                    break;

                case 'tagall':
                    if (!isGroup) break;
                    let textTag = 'Attention everyone!\n\n';
                    const participants = await sock.groupMetadata(from).then(m => m.participants);
                    participants.forEach(p => textTag += `@${p.id.split('@')[0]}\n`);
                    await sock.sendMessage(from, { text: textTag, mentions: participants.map(p => p.id) });
                    break;

                case 'quote':
                    const q = await (await fetch('https://api.quotable.io/random')).json();
                    await sock.sendMessage(from, { text: `"${q.content}"\n— ${q.author}` });
                    break;

                case 'meme':
                    const meme = await (await fetch('https://meme-api.com/gimme')).json();
                    await sock.sendMessage(from, { image: { url: meme.url }, caption: meme.title });
                    break;

                case 'tts':
                    const ttsText = args.join(' ');
                    if (!ttsText) break;
                    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(ttsText)}`;
                    await sock.sendMessage(from, { audio: { url: ttsUrl }, mimetype: 'audio/mpeg' });
                    break;

                case 'time':
                    await sock.sendMessage(from, { text: new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) });
                    break;

                case 'weather':
                    const city = args.join(' ');
                    if (!city) break;
                    const w = await (await fetch(`http://api.openweathermap.org/data/2.5/weather?q=${city}&appid=your_api_key&units=metric`)).json();
                    await sock.sendMessage(from, { text: `${city}: ${w.weather[0].description}, ${w.main.temp}°C` });
                    break;

                case 'imagine':
                    await sock.sendMessage(from, { text: "Generating AI image..." });
                    const img = await (await fetch(`https://api.yanzapi.com/v1/imagine?prompt=${encodeURIComponent(args.join(' '))}`)).json();
                    await sock.sendMessage(from, { image: { url: img.result } });
                    break;

                case 'truth':
                    const truths = ["Who do you have a crush on?", "Worst habit?", "Ever cheated?"];
                    await sock.sendMessage(from, { text: `Truth: ${truths[Math.floor(Math.random() * truths.length)]}` });
                    break;

                case 'dare':
                    const dares = ["Sing a song in voice note", "Say I love you to a random contact", "Dance on video"];
                    await sock.sendMessage(from, { text: `Dare: ${dares[Math.floor(Math.random() * dares.length)]}` });
                    break;

                case 'restart':
                    if (!isOwner) break;
                    await sock.sendMessage(from, { text: "Restarting..." });
                    process.exit(1);
                    break;

                default:
                    await sock.sendMessage(from, { text: `Command not found. Use ${prefix}menu` });
            }
        } catch (err) {
            console.log(err);
        }
    });

    // Auto Welcome
    sock.ev.on('group-participants.update', async (update) => {
        if (update.action === 'add') {
            const user = update.participants[0].split('@')[0];
            await sock.sendMessage(update.id, { text: welcomeMsg.replace('@user', `@${user}`), mentions: [update.participants[0]] });
        }
    });
}

startBot();

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit /qr to see QR code`);
});

export default app;