/**
 * BRDForge — Offline Server
 * Node.js backend with JIRA proxy + Anthropic relay
 *
 * Usage:
 *   npm install && node server.js
 *   Open: http://localhost:3000
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ──────────────────────────────
//  CONFIG (edit or use .env)
// ──────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || 3000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const JIRA_URL = (process.env.JIRA_URL || '').replace(/\/$/, '');
const JIRA_EMAIL = process.env.JIRA_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_TOKEN || '';

// ──────────────────────────────
//  MIME TYPES
// ──────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.md':   'text/markdown',
  '.ico':  'image/x-icon',
};

// ──────────────────────────────
//  HELPERS
// ──────────────────────────────
function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function proxyRequest(options, body, res) {
  const req = https.request(options, (r) => {
    let data = '';
    r.on('data', chunk => data += chunk);
    r.on('end', () => {
      res.writeHead(r.statusCode, {
        'Content-Type': r.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      });
      res.end(data);
    });
  });
  req.on('error', e => sendJSON(res, 500, { error: e.message }));
  if (body) req.write(body);
  req.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch(e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ──────────────────────────────
//  SERVER
// ──────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' });
    res.end();
    return;
  }

  // ── JIRA PROXY ──────────────────
  if (pathname.startsWith('/api/jira/')) {
    const jiraPath = pathname.replace('/api/jira', '');
    const jUrl = JIRA_URL || parsed.query.jiraUrl;
    const jEmail = JIRA_EMAIL || parsed.query.jiraEmail;
    const jToken = JIRA_TOKEN || parsed.query.jiraToken;

    if (!jUrl || !jEmail || !jToken) {
      return sendJSON(res, 400, { error: 'JIRA not configured. Set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN in .env or Settings.' });
    }

    const jParsed = url.parse(jUrl);
    const options = {
      hostname: jParsed.hostname,
      port: 443,
      path: jiraPath,
      method: req.method,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${jEmail}:${jToken}`).toString('base64'),
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };
    const body = req.method !== 'GET' ? await parseBody(req) : null;
    proxyRequest(options, body ? JSON.stringify(body) : null, res);
    return;
  }

  // ── JIRA ISSUE FETCH ────────────
  if (pathname.startsWith('/api/jira-issue/')) {
    const issueId = pathname.split('/').pop().toUpperCase();
    const jUrl = JIRA_URL;
    const jEmail = JIRA_EMAIL;
    const jToken = JIRA_TOKEN;

    if (!jUrl) return sendJSON(res, 400, { error: 'JIRA_URL not set in .env' });

    const jParsed = url.parse(jUrl);
    const options = {
      hostname: jParsed.hostname, port: 443,
      path: `/rest/api/3/issue/${issueId}`,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${jEmail}:${jToken}`).toString('base64'),
        'Accept': 'application/json'
      }
    };
    const apiReq = https.request(options, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const d = JSON.parse(data);
          const f = d.fields || {};
          sendJSON(res, r.statusCode, {
            id: d.key, summary: f.summary || '',
            description: extractText(f.description),
            status: f.status?.name, priority: f.priority?.name,
            assignee: f.assignee?.displayName || 'Unassigned',
            reporter: f.reporter?.displayName,
            created: (f.created||'').split('T')[0],
            updated: (f.updated||'').split('T')[0],
            labels: (f.labels||[]).join(', '),
            components: (f.components||[]).map(c=>c.name).join(', '),
            fixVersions: (f.fixVersions||[]).map(v=>v.name).join(', '),
            comments: (f.comment?.comments||[]).slice(-3).map(c=>`[${c.author?.displayName}]: ${extractText(c.body)}`).join('\n'),
            attachments: (f.attachment||[]).map(a=>a.filename).join(', ')
          });
        } catch(e) { sendJSON(res, 500, { error: 'Failed to parse JIRA response: ' + e.message }); }
      });
    });
    apiReq.on('error', e => sendJSON(res, 500, { error: e.message }));
    apiReq.end();
    return;
  }

  // ── JIRA SEARCH ─────────────────
  if (pathname === '/api/jira-search') {
    const q = parsed.query.q || '';
    if (!JIRA_URL) return sendJSON(res, 400, { error: 'JIRA not configured' });
    const jParsed = url.parse(JIRA_URL);
    const jql = encodeURIComponent(`text ~ "${q}" ORDER BY updated DESC`);
    const options = {
      hostname: jParsed.hostname, port: 443,
      path: `/rest/api/3/issue/picker?query=${encodeURIComponent(q)}&showSubTasks=true`,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64'),
        'Accept': 'application/json'
      }
    };
    const apiReq = https.request(options, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { res.writeHead(r.statusCode, { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }); res.end(data); });
    });
    apiReq.on('error', e => sendJSON(res, 500, { error: e.message }));
    apiReq.end();
    return;
  }

  // ── ANTHROPIC PROXY ─────────────
  if (pathname === '/api/claude') {
    const body = await parseBody(req);
    const apiKey = ANTHROPIC_KEY || req.headers['x-api-key'] || '';
    const options = {
      hostname: 'api.anthropic.com', port: 443,
      path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    };
    proxyRequest(options, JSON.stringify(body), res);
    return;
  }

  // ── CONFIG API ──────────────────
  if (pathname === '/api/config') {
    sendJSON(res, 200, {
      jiraConfigured: !!(JIRA_URL && JIRA_EMAIL && JIRA_TOKEN),
      anthropicConfigured: !!ANTHROPIC_KEY,
      jiraUrl: JIRA_URL,
      jiraEmail: JIRA_EMAIL,
      port: PORT
    });
    return;
  }

  // ── HEALTH ──────────────────────
  if (pathname === '/health') {
    sendJSON(res, 200, { status: 'ok', version: '2.0', time: new Date().toISOString() });
    return;
  }

  // ── STATIC FILES ────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
});

function extractText(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  try {
    return (doc.content||[]).map(b => {
      if (b.type==='paragraph') return (b.content||[]).map(n=>n.text||'').join('');
      if (b.type==='bulletList') return (b.content||[]).map(li=>'• '+(li.content?.[0]?.content||[]).map(n=>n.text||'').join('')).join('\n');
      if (b.type==='orderedList') return (b.content||[]).map((li,i)=>`${i+1}. `+(li.content?.[0]?.content||[]).map(n=>n.text||'').join('')).join('\n');
      if (b.type==='heading') return (b.content||[]).map(n=>n.text||'').join('');
      return '';
    }).filter(Boolean).join('\n');
  } catch { return ''; }
}

server.listen(PORT, () => {
  console.log('\n');
  console.log('  ╔════════════════════════════════════╗');
  console.log('  ║      BRDForge v2.0 — Running       ║');
  console.log('  ╚════════════════════════════════════╝');
  console.log(`\n  App:     http://localhost:${PORT}`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`  Config:  http://localhost:${PORT}/api/config`);
  console.log(`\n  JIRA:    ${JIRA_URL ? '✓ Configured (' + JIRA_URL + ')' : '✗ Not configured (add to .env)'}`);
  console.log(`  Claude:  ${ANTHROPIC_KEY ? '✓ API key set' : '✗ Not configured (add ANTHROPIC_API_KEY to .env)'}`);
  console.log('\n  Press Ctrl+C to stop\n');
});
