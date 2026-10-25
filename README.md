# 💞 Us Two — video call + games

A little website for two people to video call **and** play games together at the same time.

## How to use
1. Open the site, type your name, and tap **Create a room**.
2. Tap **🔗 Invite** to copy the link (or share the 5-letter room code) and send it to your partner.
3. They open the link, type their name, and tap **Join the room**.
4. You'll see each other on video. Pick any game and it opens on both screens.

There's also a chat box and a ❤️ button that sends floating hearts.

## The 18 games
| | Game | How it works |
|---|---|---|
| ❌ | Tic-Tac-Toe | Take turns, three in a row wins |
| 🔴 | Connect Four | Drop discs, line up four |
| ✂️ | Rock Paper Scissors | Pick in secret, reveal together |
| 🃏 | Memory Match | Take turns finding pairs |
| 🧩 | Sliding Puzzle Race | Same scrambled puzzle, first to solve wins |
| 🎨 | Draw & Guess | One draws a secret word, the other guesses |
| 🔤 | Hangman | Set a secret word for your partner |
| 🧠 | Trivia Duel | 10 questions, both answer |
| 🤔 | Would You Rather | See how often you pick the same thing |
| 💘 | How Well Do You Know Me? | One answers about themselves, the other guesses |
| 🚢 | Battleship | Hide your fleet, take turns firing |
| 🟦 | Dots & Boxes | Draw lines, close boxes to claim them |
| 🟩 | Word Duel | Same secret 5-letter word, fewest guesses wins |
| ⚡ | Reaction Race | Tap when it turns green — fastest wins |
| 🔥 | Truth or Dare | Couple-friendly truths and video-call dares |
| 🙈 | Never Have I Ever | Answer secretly, reveal together |
| 🎬 | Emoji Riddles | Guess the movie or phrase from emojis |
| 🎭 | Charades | Act out the word on camera — 60 seconds per turn |

## Putting it online (free, GitHub Pages)
1. In this repo on GitHub go to **Settings → Pages**.
2. Under **Build and deployment**, pick **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
3. After a minute the site is live at `https://lateefahh.github.io`.

It's just static files (`index.html`, `styles.css`, `games.js`, `app.js`), so it also works on Netlify, Vercel, etc.

## How it works
Video and game moves go directly between your two browsers over WebRTC using [PeerJS](https://peerjs.com/).
The free PeerJS cloud server is only used to introduce the two browsers to each other. No accounts, nothing is stored.
The page must be served over **https** (GitHub Pages is) for the camera to work.
