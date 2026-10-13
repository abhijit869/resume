# Puter Chat

A polished, serverless AI chat app built with [Puter.js](https://developer.puter.com). There is no backend of your own and no API keys in the app. Users sign in with Puter and pay for model usage from their own account.

## Features

- Streaming replies via `puter.ai.chat({ stream: true })`
- Model picker populated from `puter.ai.listModels()`
- Optional OpenAI web search tool
- Image attachments
- Multiple conversations with titles
- Local cache plus Puter key-value persistence after sign-in
- Inline context compaction for long threads

## Run it

Puter.js needs a real origin, so do not open `index.html` from disk.

```bash
node server.mjs
```

Then open [http://localhost:5173](http://localhost:5173).

## Notes

The footer links to [developer.puter.com](https://developer.puter.com) as required by Puter.js.
