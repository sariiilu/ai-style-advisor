require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));   // base64 images can be large
app.use(express.static(path.join(__dirname, 'public')));

// ── Gemini client (initialised once, key from env only) ────────────────────
function getGemini() {
  if (!API_KEY) {
    throw new Error('GOOGLE_API_KEY ist nicht gesetzt. Bitte in den Environment Variables hinterlegen.');
  }
  return new GoogleGenerativeAI(API_KEY).getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: { temperature: 0.85, maxOutputTokens: 5000 }
  });
}

// ── Helper: build prompt from profile ─────────────────────────────────────
function buildStylePrompt(profile, count) {
  return `Du bist ein professioneller Fashion-Stilberater. Analysiere das/die hochgeladene(n) Foto(s) und erstelle ${count} konkrete Outfit-Empfehlungen.

NUTZERPROFIL:
- Körpertyp: ${profile.bodyType || 'nicht angegeben'}
- Farbtyp: ${profile.colorType || 'nicht angegeben'}
- Bevorzugte Stile: ${profile.styles?.join(', ') || 'nicht angegeben'}
- Anlässe: ${profile.occasions?.join(', ') || 'nicht angegeben'}
- Budget: ${profile.budget || 'nicht angegeben'}
- Lieblings-Farben: ${profile.favoriteColors || 'nicht angegeben'}
- Vermeiden: ${profile.avoidColors || 'nicht angegeben'}
- Besonderheiten: ${profile.specialNotes || 'keine'}

AUFGABE: Erstelle exakt ${count} Outfit-Empfehlungen als JSON-Array.
Jedes Objekt MUSS folgende Felder haben:
{
  "name": "Kurzer kreativer Outfit-Name (z.B. Business Chic, Weekend Vibes)",
  "occasion": "Anlass (z.B. Business, Casual, Abend)",
  "description": "2-3 Sätze warum dieses Outfit zum Typ passt",
  "items": [
    { "category": "Oberteil", "item": "Konkretes Kleidungsstück", "color": "Farbe", "tip": "Styling-Tipp" },
    { "category": "Hose/Rock", "item": "Konkretes Kleidungsstück", "color": "Farbe", "tip": "Styling-Tipp" },
    { "category": "Schuhe", "item": "Schuhtyp", "color": "Farbe", "tip": "Styling-Tipp" },
    { "category": "Accessoires", "item": "Accessoire", "color": "Farbe", "tip": "Styling-Tipp" }
  ],
  "colors": ["#HEX1", "#HEX2", "#HEX3"],
  "priceRange": "€ / €€ / €€€",
  "fit": "Warum dieser Schnitt für den Körpertyp ideal ist"
}

Antworte NUR mit dem JSON-Array, ohne Markdown-Codeblöcke oder sonstigen Text.`;
}

// ── Helper: build parts array (text + images) ─────────────────────────────
function buildParts(profile, images, count) {
  const parts = [];
  for (const img of (images || [])) {
    // img = { mimeType: 'image/jpeg', data: '<base64>' }
    if (img && img.data && img.mimeType) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  parts.push({ text: buildStylePrompt(profile, count) });
  return parts;
}

// ── POST /api/analyze ──────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const { profile, images, count = 3 } = req.body;

    if (!profile) {
      return res.status(400).json({ error: 'Kein Profil übermittelt.' });
    }

    const model = getGemini();
    const parts = buildParts(profile, images, count);

    const result = await model.generateContent({ contents: [{ parts }] });
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip markdown code fences if present
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = clean.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('Gemini response (no JSON found):', text.slice(0, 500));
      return res.status(500).json({ error: 'KI-Antwort enthält kein valides JSON.' });
    }

    const looks = JSON.parse(jsonMatch[0]);

    // Enrich each look with id and gradient
    const enriched = looks.map((look, i) => ({
      ...look,
      id: i + 1,
      gradient: buildGradient(look.colors),
      tags: inferTags(look)
    }));

    res.json({ looks: enriched });

  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message || 'Interner Serverfehler' });
  }
});

// ── POST /api/chat ─────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, looks } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Kein Nachrichtenverlauf übermittelt.' });
    }

    const model = getGemini();

    const systemContext = looks?.length
      ? `Du bist ein KI-Stilberater. Es wurden folgende Looks für die Nutzerin erstellt: ${JSON.stringify(looks.map(l => ({ name: l.name, occasion: l.occasion })))}. Beantworte Fragen zu den Outfits, gib Styling-Tipps und sei freundlich und hilfreich.`
      : 'Du bist ein KI-Stilberater. Beantworte Fragen rund um Mode, Styling und Outfits. Sei freundlich, kompetent und konkret.';

    // Build conversation history for Gemini
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: systemContext }] },
        { role: 'model', parts: [{ text: 'Verstanden! Ich bin bereit, dir bei allen Stilfragen zu helfen.' }] },
        ...history
      ]
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    const reply = result.response.candidates?.[0]?.content?.parts?.[0]?.text || 'Ich konnte keine Antwort generieren.';

    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message || 'Interner Serverfehler' });
  }
});

// ── Helper: gradient from color array ─────────────────────────────────────
function buildGradient(colors) {
  if (!colors || colors.length === 0) return 'linear-gradient(135deg,#795A71,#CF9775)';
  const valid = colors.filter(c => /^#[0-9A-Fa-f]{3,8}$/.test(c));
  if (valid.length === 0) return 'linear-gradient(135deg,#795A71,#CF9775)';
  if (valid.length === 1) return `linear-gradient(135deg,${valid[0]},${valid[0]}cc)`;
  return `linear-gradient(135deg,${valid.join(',')})`;
}

// ── Helper: infer tags from look data ─────────────────────────────────────
function inferTags(look) {
  const tags = [];
  const occ = (look.occasion || '').toLowerCase();
  if (occ.includes('business') || occ.includes('büro')) tags.push('Business');
  if (occ.includes('casual') || occ.includes('alltag')) tags.push('Casual');
  if (occ.includes('abend') || occ.includes('event') || occ.includes('party')) tags.push('Abend');
  if (occ.includes('sport') || occ.includes('active')) tags.push('Sport');
  if (occ.includes('date') || occ.includes('romantisch')) tags.push('Date');
  const pr = (look.priceRange || '');
  if (pr.includes('€€€')) tags.push('Premium');
  else if (pr.includes('€€')) tags.push('Mid-Range');
  else if (pr.includes('€')) tags.push('Budget');
  return tags.length ? tags : ['Everyday'];
}

// ── Fallback: serve index.html for all non-API routes ─────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ AI Style Advisor läuft auf Port ${PORT}`);
  if (!API_KEY) {
    console.warn('⚠️  GOOGLE_API_KEY nicht gesetzt — KI-Funktionen werden nicht funktionieren!');
  }
});
