require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper: call Gemini REST API directly (no npm package needed) ──────────
async function callGemini(parts, maxTokens = 5000, temperature = 0.85) {
  if (!GEMINI_KEY) throw new Error('GOOGLE_API_KEY ist nicht gesetzt.');

  const url = `${GEMINI_URL}?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API Fehler ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

// ── Helper: style prompt ───────────────────────────────────────────────────
function buildStylePrompt(profile, count) {
  return `Du bist ein professioneller Fashion-Stilberater. Analysiere das/die hochgeladene(n) Foto(s) und erstelle ${count} konkrete Outfit-Empfehlungen.

NUTZERPROFIL:
- Körpertyp: ${profile.bodyType || 'nicht angegeben'}
- Farbtyp: ${profile.colorType || 'nicht angegeben'}
- Bevorzugte Stile: ${(profile.styles || []).join(', ') || 'nicht angegeben'}
- Anlässe: ${(profile.occasions || []).join(', ') || 'nicht angegeben'}
- Budget: ${profile.budget || 'nicht angegeben'}
- Lieblingsfarben: ${profile.favoriteColors || 'nicht angegeben'}
- Vermeiden: ${profile.avoidColors || 'nicht angegeben'}
- Besonderheiten: ${profile.specialNotes || 'keine'}

AUFGABE: Erstelle exakt ${count} Outfit-Empfehlungen als JSON-Array.
Jedes Objekt MUSS folgende Felder haben:
[
  {
    "name": "Kurzer kreativer Outfit-Name",
    "occasion": "Anlass (z.B. Business, Casual, Abend, Date)",
    "description": "2-3 Sätze warum dieses Outfit zum Typ passt",
    "items": [
      { "category": "Oberteil", "item": "konkretes Kleidungsstück", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "Hose/Rock", "item": "konkretes Kleidungsstück", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "Schuhe", "item": "Schuhtyp", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "Accessoires", "item": "Accessoire", "color": "Farbe", "tip": "Styling-Tipp" }
    ],
    "colors": ["#HEX1", "#HEX2", "#HEX3"],
    "priceRange": "€ oder €€ oder €€€",
    "fit": "Warum dieser Schnitt für den Körpertyp ideal ist"
  }
]

Antworte NUR mit dem JSON-Array. Kein Text davor oder danach, keine Markdown-Codeblöcke.`;
}

// ── POST /api/analyze ──────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const { profile, images, count = 3 } = req.body;
    if (!profile) return res.status(400).json({ error: 'Kein Profil übermittelt.' });

    // Build parts: optional images + text prompt
    const parts = [];
    for (const img of (images || [])) {
      if (img?.data && img?.mimeType) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }
    parts.push({ text: buildStylePrompt(profile, parseInt(count) || 3) });

    const text = await callGemini(parts, 6000, 0.85);

    // Strip markdown fences if Gemini adds them
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = clean.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('Gemini raw response:', text.slice(0, 600));
      return res.status(500).json({ error: 'KI-Antwort enthält kein gültiges JSON. Bitte erneut versuchen.' });
    }

    const looks = JSON.parse(jsonMatch[0]);
    const enriched = looks.map((look, i) => ({
      ...look,
      id: i + 1,
      gradient: buildGradient(look.colors),
      tags: inferTags(look)
    }));

    res.json({ looks: enriched });

  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/chat ─────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, looks } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'Keine Nachrichten.' });

    const looksContext = looks?.length
      ? `Die Nutzerin hat folgende Looks erhalten: ${looks.map(l => `"${l.name}" (${l.occasion})`).join(', ')}.`
      : '';

    // Build a single prompt with full conversation history
    const history = messages.map(m =>
      `${m.role === 'user' ? 'Nutzerin' : 'StyleAI'}: ${m.content}`
    ).join('\n\n');

    const prompt = `Du bist StyleAI, ein freundlicher und kompetenter KI-Stilberater. ${looksContext}

Konversation bisher:
${history}

Antworte jetzt als StyleAI auf die letzte Nachricht der Nutzerin. Sei konkret, hilfreich und auf Deutsch.`;

    const parts = [{ text: prompt }];
    const reply = await callGemini(parts, 1000, 0.75);

    res.json({ reply: reply.trim() });

  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function buildGradient(colors) {
  if (!colors?.length) return 'linear-gradient(135deg,#795A71,#CF9775)';
  const valid = colors.filter(c => /^#[0-9A-Fa-f]{3,8}$/.test(c));
  if (!valid.length) return 'linear-gradient(135deg,#795A71,#CF9775)';
  if (valid.length === 1) return `linear-gradient(135deg,${valid[0]},${valid[0]}99)`;
  return `linear-gradient(135deg,${valid.join(',')})`;
}

function inferTags(look) {
  const tags = [];
  const occ = (look.occasion || '').toLowerCase();
  if (occ.includes('business') || occ.includes('büro') || occ.includes('meeting')) tags.push('Business');
  if (occ.includes('casual') || occ.includes('alltag') || occ.includes('wochenende')) tags.push('Casual');
  if (occ.includes('abend') || occ.includes('event') || occ.includes('party') || occ.includes('feier')) tags.push('Abend');
  if (occ.includes('date') || occ.includes('romantisch')) tags.push('Date');
  if (occ.includes('sport')) tags.push('Sport');
  const pr = look.priceRange || '';
  if (pr.includes('€€€')) tags.push('Premium');
  else if (pr.includes('€€')) tags.push('Mid-Range');
  else if (pr === '€') tags.push('Budget');
  return tags.length ? tags : ['Everyday'];
}

// ── Health check (useful for Render) ──────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', apiKey: !!GEMINI_KEY }));

// ── Catch-all → index.html ─────────────────────────────────────────────────
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ StyleAI Server läuft auf Port ${PORT}`);
  if (!GEMINI_KEY) {
    console.warn('⚠️  GOOGLE_API_KEY fehlt! KI-Funktionen sind deaktiviert.');
  } else {
    console.log('🔑 Gemini API Key: gesetzt');
  }
});
