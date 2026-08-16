require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

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

// ── Trend-Liste 2026/2027 (für beide Modi) ────────────────────────────────
const TRENDS_2026 = `
Aktuelle Modetrends 2026/2027:
- Fluid Tailoring: weiche, fließende Anzugteile in gedeckten Tönen (Taupe, Stein, Schiefergrau)
- Utility Chic: Cargo-Details, technische Stoffe und funktionale Elemente elegant kombiniert
- New Romanticism: Rüschen, florale Prints, Puffärmel — modern und selbstbewusst interpretiert
- Tonal Dressing: Monochrome Looks in einer Farbe, verschiedene Texturen und Töne
- Deconstructed Classics: Klassiker neu interpretiert — asymmetrisch, oversized, unfertig wirkend
- Sport Luxe 2.0: Sportliche Silhouetten mit luxuriösen Materialien kombiniert
- Neo-Minimalism: Hochwertige Basics, klare Linien, reduzierte Accessoires in Nude/Weiß/Schwarz
- Retro Futurism: Metallische Akzente, strukturierte Schultern, Space-Age-Details
- Coastal Cool: Leinen, maritime Farben, entspannte aber polierte Eleganz
- Power Feminine: Starke Schultern, taillierte Schnitte, tiefe Farben (Bordeaux, Pflaume, Nachtblau)
- Gorpcore: Outdoor-Funktionskleidung (Fleece, Wander-Ästhetik) als modisches Statement
- Quiet Luxury: Dezente Logos, hochwertige Materialien, zeitloser Stil ohne Auffälligkeit`;

// ── Helper: Wardrobe-Modus Prompt (Kleiderschrank analysieren) ─────────────
function buildWardrobePrompt(profile, count) {
  return `Du bist ein professioneller Fashion-Stilberater mit Expertise in den neuesten Trends.

SCHRITT 1 — KLEIDERSCHRANK ANALYSIEREN:
Schaue dir alle hochgeladenen Fotos genau an. Identifiziere jeden sichtbaren Kleidungsstück:
- Art (z.B. Blazer, Jeans, Bluse, Sneaker, Kleid, Mantel)
- Farbe und Material soweit erkennbar
- Stil (klassisch, casual, sportlich, elegant etc.)

NUTZERPROFIL:
- Körpertyp: ${profile.bodyType || 'nicht angegeben'}
- Farbtyp: ${profile.colorType || 'nicht angegeben'}
- Budget für Ergänzungen: ${profile.budget || 'nicht angegeben'}
- Lieblingsfarben: ${profile.favoriteColors || 'nicht angegeben'}
- Farben/Muster vermeiden: ${profile.avoidColors || 'nicht angegeben'}
- Gewünschte Anlässe: ${(profile.occasions || []).join(', ') || 'nicht angegeben'}

${TRENDS_2026}

SCHRITT 2 — ${count} OUTFITS AUS VORHANDENEN TEILEN ERSTELLEN:
Kombiniere die erkannten Kleidungsstücke zu trendigen Outfits. Nutze primär vorhandene Teile, schlage maximal 2 Kaufteile pro Outfit vor.

Antworte NUR mit diesem JSON-Array (kein Text davor/danach, keine Markdown-Blöcke):
[
  {
    "name": "Kreativer Outfit-Name",
    "occasion": "Anlass (Business / Casual / Abend / Date / Wochenende)",
    "trend": "Welchen 2026/2027-Trend greift dieses Outfit auf (1 Satz)",
    "description": "2-3 Sätze: welche Teile kombiniert werden und warum es trendig ist",
    "wardrobeItems": ["Teil 1 aus Kleiderschrank-Foto", "Teil 2 aus Kleiderschrank-Foto"],
    "items": [
      { "category": "✅ Vorhanden", "item": "Konkretes Teil aus dem Kleiderschrank", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "✅ Vorhanden", "item": "Weiteres vorhandenes Teil", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "🛍️ Kauftipp", "item": "Empfohlenes Ergänzungsteil", "color": "Empfohlene Farbe", "tip": "Warum es den Look vervollständigt" },
      { "category": "🛍️ Kauftipp", "item": "Optionales Accessoire oder Schuhe", "color": "Farbe", "tip": "Styling-Tipp" }
    ],
    "colors": ["#HEX1", "#HEX2", "#HEX3"],
    "priceRange": "Kaufteile kosten ca.: € / €€ / €€€",
    "shoppingTip": "Konkrete Shops für die Kaufteile (Zara, H&M, Vinted, About You etc.)"
  }
]`;`;
}

// ── Helper: Generator-Modus Prompt (Profil-basiert, ohne eigene Kleidung) ──
function buildGeneratorPrompt(profile, count) {
  const occasions = (profile.occasions || []).join(', ') || 'Alltag';
  return `Du bist ein professioneller Fashion-Stilberater. Erstelle ${count} komplette, kauffertige Outfit-Empfehlungen passend zum Profil und aktuellen Trends.

NUTZERPROFIL:
- Körpertyp: ${profile.bodyType || 'nicht angegeben'}
- Farbtyp: ${profile.colorType || 'nicht angegeben'}
- Bevorzugte Stile: ${(profile.styles || []).join(', ') || 'nicht angegeben'}
- Gewünschte Anlässe: ${occasions}
- Budget: ${profile.budget || 'nicht angegeben'}
- Lieblingsfarben: ${profile.favoriteColors || 'nicht angegeben'}
- Farben/Muster vermeiden: ${profile.avoidColors || 'nicht angegeben'}
- Besonderheiten: ${profile.specialNotes || 'keine'}

${TRENDS_2026}

AUFGABE: Erstelle ${count} vollständige Outfit-Empfehlungen die:
1. Perfekt zum Körpertyp und Farbtyp passen
2. Aktuelle 2026/2027-Trends aufgreifen
3. Für die gewünschten Anlässe geeignet sind
4. Konkrete, kaufbare Kleidungsstücke nennen (mit Markenbeispielen wenn passend)
${profile.bodyType ? `5. Schnitte wählen die ${profile.bodyType} optimal in Szene setzen` : ''}

Antworte NUR mit diesem JSON-Array (kein Text davor/danach, keine Markdown-Blöcke):
[
  {
    "name": "Kreativer Outfit-Name",
    "occasion": "Anlass (Business / Casual / Abend / Date / Wochenende)",
    "trend": "Welchen 2026/2027-Trend greift dieses Outfit auf (1 Satz)",
    "description": "2-3 Sätze warum dieses Outfit perfekt zum Profil und Trend passt",
    "wardrobeItems": [],
    "items": [
      { "category": "👚 Oberteil", "item": "Konkretes Kleidungsstück + Markenbeispiel", "color": "Empfohlene Farbe", "tip": "Warum dieser Schnitt für den Körpertyp ideal ist" },
      { "category": "👖 Hose/Rock", "item": "Konkretes Kleidungsstück", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "👟 Schuhe", "item": "Schuhtyp + Beispiel", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "💍 Accessoires", "item": "Tasche, Schmuck oder Gürtel", "color": "Farbe", "tip": "Finishing Touch" }
    ],
    "colors": ["#HEX1", "#HEX2", "#HEX3"],
    "priceRange": "Gesamtbudget ca.: € (<100€) / €€ (100-300€) / €€€ (300€+)",
    "shoppingTip": "Wo man dieses Outfit günstig zusammenstellt (Zara, H&M, Mango, Vinted, About You, ASOS etc.)",
    "fit": "Warum diese Silhouette optimal für den Körpertyp ist"
  }
]`;
}

// ── POST /api/analyze ──────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const { profile, images, count = 3, mode = 'wardrobe' } = req.body;
    if (!profile) return res.status(400).json({ error: 'Kein Profil übermittelt.' });

    const n = parseInt(count) || 3;
    const prompt = mode === 'generator'
      ? buildGeneratorPrompt(profile, n)
      : buildWardrobePrompt(profile, n);

    // Build parts: optional images (wardrobe mode) + text prompt
    const parts = [];
    for (const img of (images || [])) {
      if (img?.data && img?.mimeType) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }
    parts.push({ text: prompt });

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
