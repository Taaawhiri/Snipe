// Riconoscimento della carta da una foto. Motore scelto con la variabile SCAN_PROVIDER:
// - "workers-ai" (predefinito): modello per immagini di Cloudflare Workers AI, nessuna chiave esterna.
// - "claude": Claude Haiku 5.5, e Claude Opus 5.5 come riserva quando Haiku non è sicuro (serve ANTHROPIC_API_KEY).
import Anthropic from '@anthropic-ai/sdk';
import { SCAN_PROMPT, parseScan } from './cardid.js';

const CF_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function withWorkersAI(env, bytes, mime) {
  if (!env.AI) throw new Error('Workers AI non collegato al Worker');
  const dataUrl = `data:${mime};base64,${toBase64(bytes)}`;
  // Formato attuale: immagine dentro il messaggio, come parte del contenuto.
  const inMessage = () => env.AI.run(CF_MODEL, {
    messages: [{ role: 'user', content: [{ type: 'text', text: SCAN_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    max_tokens: 300,
  });
  // Formato precedente: messaggio di testo e immagine a parte (byte).
  const separate = () => env.AI.run(CF_MODEL, {
    messages: [{ role: 'system', content: 'You read Pokémon cards and answer only with JSON.' }, { role: 'user', content: SCAN_PROMPT }],
    image: [...bytes],
    max_tokens: 300,
  });
  const attempt = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      // Il modello di Meta chiede di accettare la licenza con una prima richiesta "agree".
      if (!/agree|licen/i.test(String(e && e.message))) throw e;
      await env.AI.run(CF_MODEL, { prompt: 'agree' }).catch(() => null);
      return fn();
    }
  };
  let out;
  try {
    out = await attempt(inMessage);
  } catch (first) {
    try {
      out = await attempt(separate);
    } catch {
      throw first;
    }
  }
  const text = out && (out.response ?? out.result ?? out);
  return { scan: parseScan(typeof text === 'string' ? text : JSON.stringify(text)), engine: 'workers-ai' };
}

async function askClaude(client, model, b64, mime, opus) {
  const params = {
    model,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text: SCAN_PROMPT },
      ],
    }],
  };
  const res = opus
    // Opus 5.5: sforzo basso (basta per leggere una carta) e riserva lato server in caso di rifiuto.
    ? await client.beta.messages.create({ ...params, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);
  if (res.stop_reason === 'refusal') return null;
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return parseScan(text);
}

async function withClaude(env, bytes, mime) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Manca ANTHROPIC_API_KEY per usare Claude');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const b64 = toBase64(bytes);
  let scan = await askClaude(client, env.SCAN_CLAUDE_MODEL || 'claude-haiku-5-5', b64, mime, false);
  let engine = 'claude-haiku';
  // Riserva: se Haiku non è sicuro, la stessa foto va a Opus.
  if ((!scan || !scan.name || (scan.confidence ?? 0) < 0.6) && env.SCAN_CLAUDE_FALLBACK !== 'off') {
    const better = await askClaude(client, 'claude-opus-5-5', b64, mime, true).catch(() => null);
    if (better && better.name) { scan = better; engine = 'claude-opus'; }
  }
  return { scan, engine };
}

/** bytes: Uint8Array dell'immagine (JPEG/PNG/WebP). */
export async function recognizeCard(env, bytes, mime = 'image/jpeg') {
  const provider = String(env.SCAN_PROVIDER || 'workers-ai').toLowerCase();
  return provider === 'claude' ? withClaude(env, bytes, mime) : withWorkersAI(env, bytes, mime);
}
