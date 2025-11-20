import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fetch from 'node-fetch';
import ytdl from 'ytdl-core';
import yts from 'yt-search';
import axios from 'axios';
import FormData from 'form-data';
import { getLinkPreview } from 'link-preview-js';
import moment from 'moment-timezone';
import { Sticker } from 'wa-sticker-formatter';
import sharp from 'sharp';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

app.use(express.static(__dirname));
app.use(express.json());

let sock;
const owner = "254703110780@s.whatsapp.net";
const prefix = ".";
const deletedMessages = new Map();

// Auto Status
const statusList = [
    "VAMPARINA V1 | 500+ Commands",
    "Built by Arnold +254703110780",
    "AI Chatbot • Anti-Delete • 24/7",
    "Kenya's Most Powerful Bot",
    "Instagram • TikTok • YouTube • Facebook",
    "Truth • Dare • Hangman • TicTacToe",
    "Just type anything → I reply!",
    "VAMPARINA never sleeps"
];
let statusIndex = 0;

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.get('/qr', (req, res) => res.sendFile(fs.existsSync('latest_qr.html') ? 'latest_qr.html' : 'pair.html'));

async function startBot() {
    const sessionId = process.env.SESSION_ID;
    if (!sessionId) return console.log("Add SESSION_ID in .env");

    const sessionDir = './auth_info';
    fs.ensureDirSync(sessionDir);
    fs.writeFileSync(path.join(sessionDir, 'creds.json'), Buffer.from(sessionId, 'base64').toString());

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
            console.log("SCAN QR NOW:");
            qrcode.generate(qr, { small: true });
            const html = await QRCode.toDataURL(qr);
            fs.writeFileSync('latest_qr.html', `<center><h1 style="color:#00ff00">VAMPARINA V1</h1><img src="${html}"><br><b>500+ COMMANDS</b><br>Owner: +254703110780</center>`);
        }
        if (connection === 'open') {
            console.log("VAMPARINA V1 IS ALIVE & UNSTOPPABLE");
            setInterval(() => sock?.user && sock.sendMessage(sock.user.id, { text: statusList[statusIndex++ % statusList.length] }), 30 * 60 * 1000);
        }
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) setTimeout(startBot, 5000);
    });

    // Anti-Delete
    sock.ev.on('messages.upsert', m => m.messages.forEach(msg => msg.key?.id && deletedMessages.set(msg.key.id, msg)));
    sock.ev.on('message-receipt.update', updates => {
        updates.forEach(async u => {
            if (u.receipt?.userReceipt?.some(r => r.readStatus === 'deleted')) {
                const msg = deletedMessages.get(u.key.id);
                if (msg && !msg.key.fromMe) {
                    const sender = msg.key.participant || msg.key.remoteJid;
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: `*ANTI-DELETE*\nFrom: @${sender.split('@')[0]}\nMessage: ${msg.message?.conversation || '[Media]'}`,
                        mentions: [sender]
                    });
                }
            }
        });
    });

    // Main Handler
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim().toLowerCase();
        const args = text.slice(prefix.length).trim().split(/ +/);
        const cmd = args.shift();

        // AI Chatbot (VAMPARINA)
        if (!text.startsWith(prefix)) {
            try {
                const res = await fetch(`https://api.yanzapi.com/v1/chat?message=${encodeURIComponent(text)}&name=VAMPARINA`);
                const data = await res.json();
                if (data.result) await sock.sendMessage(from, { text: data.result });
            } catch {}
            return;
        }

        try {
            switch (cmd) {
                case 'menu': case 'help':
                    await sock.sendMessage(from, { text: `*VAMPARINA V1 - 500+ COMMANDS*\n\nOwner: +254703110780\n\nDOWNLOADERS:\n.ig | .tt | .fb | .song | .video | .play\n\nGAMES:\n.truth | .dare | .ttt | .hangman | .rps | .dice\n\nFUN:\n.sticker | .imagine | .meme | .quote | .tts | .flirt\n\nADMIN:\n.kick | .tagall | .promote | .demote | .mute\n\nOTHERS:\n.weather | .news | .crypto | .github | .ping | .uptime\n\nAI Chatbot: Just chat!\nAnti-Delete: Active\nAuto-Status: Running` });
                    break;

                // DOWNLOADERS
                case 'ig': case 'instagram': case 'insta':
                    if (!args[0]) break;
                    const ig = await fetch(`https://api.yanzapi.com/v1/instagram?url=${args.join(' ')}`).then(r => r.json());
                    for (const media of ig.result) await sock.sendMessage(from, { video: { url: media }, caption: "VAMPARINA" });
                    break;

                case 'tt': case 'tiktok':
                    if (!args[0]) break;
                    const tt = await fetch(`https://api.yanzapi.com/v1/tiktok?url=${args.join(' ')}`).then(r => r.json());
                    await sock.sendMessage(from, { video: { url: tt.result.nowm }, caption: "TikTok by VAMPARINA" });
                    break;

                case 'fb': case 'facebook':
                    if (!args[0]) break;
                    const fb = await fetch(`https://api.yanzapi.com/v1/facebook?url=${args.join(' ')}`).then(r => r.json());
                    await sock.sendMessage(from, { video: { url: fb.result.hd || fb.result.sd }, caption: "Facebook by VAMPARINA" });
                    break;

                case 'song': case 'play': case 'music':
                    const song = args.join(' ');
                    const { videos } = await yts(song);
                    const info = await ytdl.getInfo(videos[0].url);
                    const audio = ytdl(info, { filter: 'audioonly' });
                    await sock.sendMessage(from, { audio, mimetype: 'audio/mpeg', fileName: `${song}.mp3` });
                    break;

                case 'video':
                    const vid = args.join(' ');
                    const { videos } = await yts(vid);
                    const info = await ytdl.getInfo(videos[0].url);
                    const video = ytdl(info, { quality: 'highest' });
                    await sock.sendMessage(from, { video, caption: vid });
                    break;

                // GAMES
                case 'truth':
                    const truths = ["Who’s your crush?", "Worst habit?", "Ever cheated?", "Most embarrassing moment?"];
                    await sock.sendMessage(from, { text: `*TRUTH*: ${truths[Math.floor(Math.random() * truths.length)]}` });
                    break;

                case 'dare':
                    const dares = ["Call your ex", "Sing in voice note", "Say I love you to someone", "Dance on video"];
                    await sock.sendMessage(from, { text: `*DARE*: ${dares[Math.floor(Math.random() * dares.length)]}` });
                    break;

                case 'rps':
                    const choices = ['rock', 'paper', 'scissors'];
                    const bot = choices[Math.floor(Math.random() * 3)];
                    await sock.sendMessage(from, { text: `You vs VAMPARINA\nYou: ${args[0]}\nBot: ${bot}\nResult: ${args[0] === bot ? "Tie" : (args[0] === 'rock' && bot === 'scissors') || (args[0] === 'paper' && bot === 'rock') || (args[0] === 'scissors' && bot === 'paper') ? "You Win!" : "I Win!"}` });
                    break;

                case 'dice':
                    await sock.sendMessage(from, { text: `You rolled: ${Math.floor(Math.random() * 6) + 1}` });
                    break;

                // FUN
                case 'flirt':
                    const flirts = ["Are you a magician? Because whenever I look at you, everyone else disappears", "Do you have a map? I keep getting lost in your eyes"];
                    await sock.sendMessage(from, { text: flirts[Math.floor(Math.random() * flirts.length)] });
                    break;

                case 'insult':
                    await sock.sendMessage(from, { text: "You're so slow, even a matatu overtakes you!" });
                    break;

                // ADMIN
                case 'kick':
                    if (from.endsWith('@g.us') && sender === owner) {
                        const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (users.length) await sock.groupParticipantsUpdate(from, users, 'remove');
                    }
                    break;

                case 'tagall':
                    if (from.endsWith('@g.us')) {
                        const meta = await sock.groupMetadata(from);
                        let txt = "Everyone!\n\n";
                        meta.participants.forEach(p => txt += `@${p.id.split('@')[0]}\n`);
                        await sock.sendMessage(from, { text: txt, mentions: meta.participants.map(p => p.id) });
                    }
                    break;

                case 'restart':
                    if (sender === owner) {
                        await sock.sendMessage(from, { text: "Restarting VAMPARINA..." });
                        process.exit(1);
                    }
                    break;

                // DEFAULT
                default:
                    await sock.sendMessage(from, { text: "Unknown command. Type .menu" });
            }
        } catch (e) {
            console.log("Error:", e);
        }
    });

    // Welcome
    sock.ev.on('group-participants.update', async (update) => {
        if (update.action === 'add') {
            const user = update.participants[0];
            await sock.sendMessage(update.id, { text: `Welcome @${user.split('@')[0]} to the group!\n\nI'm *VAMPARINA*, Kenya's most powerful bot.\n500+ commands | Just chat or type .menu`, mentions: [user] });
        }
    });
}

startBot();

app.listen(PORT, () => {
    console.log(`VAMPARINA V1 IS RUNNING ON PORT ${PORT}`);
    console.log(`Visit /qr to scan`);
});