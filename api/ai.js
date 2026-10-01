// Vercel serverless function (Node.js runtime).
// Proxies AI requests from the browser to Anthropic's Messages API using a
// server-side secret (ANTHROPIC_API_KEY, set in Vercel → Project → Settings →
// Environment Variables). The key is NEVER sent to the browser — the client
// only ever talks to /api/ai, never to api.anthropic.com directly.
//
// Called by EX.makeAiClient() in index.html with two request shapes:
//   { mode: 'text', messages: [{role, content}, ...] }  -> { text }
//   { mode: 'json', prompt: '...' }                     -> { json }

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      code: 'capability_disabled',
      error: 'AI features are not configured on this deployment (missing ANTHROPIC_API_KEY environment variable in Vercel).',
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  try {
    if (body.mode === 'json') {
      const prompt = String(body.prompt || '').slice(0, 20000);
      const system = 'You are a business analyst embedded in an internal operations tool. ' +
        'Respond with ONLY valid JSON — no markdown code fences, no commentary before or after, no trailing text.';
      const text = await callAnthropic(apiKey, [{ role: 'user', content: prompt }], system, 1400);
      const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
      let json;
      try {
        json = JSON.parse(cleaned);
      } catch (e) {
        res.status(502).json({ code: 'invalid_json', error: 'AI returned data in an unexpected format — please try again.' });
        return;
      }
      res.status(200).json({ json });
      return;
    }

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const text = await callAnthropic(
      apiKey,
      rawMessages,
      'You are a helpful, concise AI assistant embedded in an internal business operations tool for Engage X Business Solutions.',
      1600
    );
    res.status(200).json({ text });
  } catch (e) {
    console.error('AI proxy error:', e);
    res.status(502).json({ code: 'unavailable', error: (e && e.message) || 'AI request failed.' });
  }
};

async function callAnthropic(apiKey, messages, system, maxTokens) {
  const safeMessages = (messages.length ? messages : [{ role: 'user', content: '' }])
    .filter((m) => m && m.content !== undefined && m.content !== null && String(m.content).trim() !== '')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));

  if (!safeMessages.length) {
    return '';
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system,
      messages: safeMessages,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('Anthropic API error ' + resp.status + ': ' + errText.slice(0, 300));
  }

  const data = await resp.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  return block ? block.text : '';
}
