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

// ── Helper: wardrobe + trend prompt ───────────────────────────────────────
function buildStylePrompt(profile, count) {
  return `Du bist ein professioneller Fashion-Stilberater mit Expertise in aktuellen Trends (2024/2025).

SCHRITT 1 — KLEIDERSCHRANK ANALYSIEREN:
Schaue dir alle hochgeladenen Fotos genau an. Identifiziere jeden sichtbaren Kleidungsstück:
- Art des Teils (z.B. Blazer, Jeans, Bluse, Sneaker)
- Farbe und Material soweit erkennbar
- Stil (klassisch, casual, sportlich, elegant etc.)

NUTZERPROFIL:
- Körpertyp: ${profile.bodyType || 'nicht angegeben'}
- Farbtyp: ${profile.colorType || 'nicht angegeben'}
- Bevorzugte Stile: ${(profile.styles || []).join(', ') || 'nicht angegeben'}
- Anlässe: ${(profile.occasions || []).join(', ') || 'nicht angegeben'}
- Budget für Ergänzungen: ${profile.budget || 'nicht angegeben'}
- Lieblingsfarben: ${profile.favoriteColors || 'nicht angegeben'}
- Vermeiden: ${profile.avoidColors || 'nicht angegeben'}
- Besonderheiten: ${profile.specialNotes || 'keine'}

SCHRITT 2 — OUTFITS AUS VORHANDENEN TEILEN ERSTELLEN:
Kombiniere die erkannten Kleidungsstücke zu ${count} trendigen Outfits passend zu aktuellen 2026/2027 Modetrends. Nutze dabei folgende aktuelle Trends:
- Fluid Tailoring (weiche, fließende Anzugteile in gedeckten Tönen)
- Utility Chic (funktionale Elemente wie Cargo-Details, technische Stoffe, stylisch kombiniert)
- New Romanticism (romantische Silhouetten, Rüschen, florale Prints modern gestylt)
- Tonal Dressing / Monochrome Layers (ein-Ton-Outfits in Erdtönen, Camel, Beige, Schiefer)
- Deconstructed Classics (klassische Stücke neu interpretiert, asymmetrisch, oversized)
- Sport Luxe 2.0 (sportliche Teile mit luxuriösen Elementen kombiniert)
- Neo-Minimalism (klare Linien, hochwertige Basics, reduzierte Accessoires)
- Retro Futurism (metallische Akzente, strukturierte Silhouetten, Space-Age-Details)
- Coastal Cool (leichte Leinenstoffe, maritime Farben, entspannte Eleganz)
- Power Feminine (starke Schultern, taillierte Schnitte, feminine Farben wie Bordeaux, Pflaume)

SCHRITT 3 — JSON-AUSGABE:
Antworte NUR mit einem JSON-Array, kein Text davor/danach, keine Markdown-Codeblöcke.

Jedes Objekt MUSS exakt diese Felder haben:
[
  {
    "name": "Kreativer Outfit-Name (z.B. 'Quiet Luxury Monday')",
    "occasion": "Anlass (Business / Casual / Abend / Date / Wochenende)",
    "trend": "Aktueller Trend 2024/2025 den dieses Outfit aufgreift (1 Satz)",
    "description": "2-3 Sätze: welche deiner Teile kombiniert werden und warum es trendig ist",
    "wardrobeItems": [
      "Beschreibung Teil 1 aus dem Kleiderschrank-Foto",
      "Beschreibung Teil 2 aus dem Kleiderschrank-Foto"
    ],
    "items": [
      { "category": "✅ Vorhanden", "item": "Konkretes Teil aus deinem Kleiderschrank", "color": "Farbe", "tip": "Wie du es stylen solltest" },
      { "category": "✅ Vorhanden", "item": "Weiteres Teil aus deinem Kleiderschrank", "color": "Farbe", "tip": "Styling-Tipp" },
      { "category": "🛍️ Ergänzung", "item": "1 empfohlenes Kaufteil das fehlt", "color": "Empfohlene Farbe", "tip": "Warum dieses Teil den Look vervollständigt" },
      { "category": "🛍️ Ergänzung", "item": "Optionales 2. Kaufteil (Accessoire oder Schuhe)", "color": "Farbe", "tip": "Styling-Tipp" }
    ],
    "colors": ["#HEX1", "#HEX2", "#HEX3"],
    "priceRange": "Budget für die Ergänzungen: € / €€ / €€€",
    "shoppingTip": "Wo und wie man die empfohlenen Ergänzungen günstig findet (z.B. Zara, H&M, Vinted, Vintage-Shops)"
  }
]

WICHTIG: Nutze primär die bereits vorhandenen Kleidungsstücke. Empfehle maximal 2 Kaufteile pro Outfit. Sei spezifisch bei der Beschreibung der vorhandenen Teile (z.B. 'der hellblaue Oversized-Blazer aus Foto 2').`;
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
