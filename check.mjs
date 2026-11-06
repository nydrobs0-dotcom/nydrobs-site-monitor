// Site monitor. Plain Node 22, no dependencies, only the default GITHUB_TOKEN.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HEARTBEAT_DAYS = 30;
export const LABEL = 'site-down';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const marker = url => `<!-- monitor:${url} -->`;
export const issueTitle = site => `Site fora do ar: ${site.name}`;

// One request with a timeout. Returns {ok, status, error}.
export async function probe(site, fetchImpl, timeoutMs) {
  try {
    const res = await fetchImpl(site.url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'site-monitor/1.0', 'cache-control': 'no-cache' },
    });
    const expected = site.expectStatus ?? 200;
    const ok = res.status === expected;
    return { ok, status: res.status, error: ok ? null : `HTTP ${res.status} (esperado ${expected})` };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError';
    return { ok: false, status: null, error: timedOut ? `sem resposta em ${timeoutMs / 1000}s` : String(error?.message || error) };
  }
}

// A site is down only if the first try and one retry both fail.
export async function checkSite(site, { fetchImpl = fetch, timeoutMs = 15000, retryDelayMs = 5000 } = {}) {
  const first = await probe(site, fetchImpl, timeoutMs);
  if (first.ok) return first;
  await sleep(retryDelayMs);
  return probe(site, fetchImpl, timeoutMs);
}

// Pure decision: given results and the open issues, what must be done.
export function decide(results, openIssues) {
  const actions = [];
  for (const { site, result } of results) {
    const mine = openIssues.filter(issue => (issue.body || '').includes(marker(site.url)));
    if (!result.ok && mine.length === 0) actions.push({ type: 'open', site, result });
    if (result.ok) for (const issue of mine) actions.push({ type: 'close', site, result, number: issue.number });
  }
  return actions;
}

// Commit status.json when something changed, and at least once a month.
export function nextStatus(prev, results, now = new Date()) {
  const sites = {};
  for (const { site, result } of results) sites[site.url] = result.ok ? 'up' : 'down';
  const changed = JSON.stringify(sites) !== JSON.stringify(prev?.sites || {});
  const last = prev?.heartbeatAt ? new Date(prev.heartbeatAt) : null;
  const stale = !last || Number.isNaN(last.getTime()) || now - last >= HEARTBEAT_DAYS * 86400000;
  if (!changed && !stale) return { write: false, status: prev };
  return { write: true, status: { heartbeatAt: now.toISOString(), sites } };
}

export function github({ token, repository, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${repository}`;
  const call = async (method, path, body) => {
    const res = await fetchImpl(base + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'site-monitor/1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    async listOpenIssues() {
      const all = [];
      for (let page = 1; page <= 10; page += 1) {
        const batch = await call('GET', `/issues?state=open&labels=${LABEL}&per_page=100&page=${page}`);
        all.push(...batch.filter(issue => !issue.pull_request));
        if (batch.length < 100) break;
      }
      return all;
    },
    openIssue: (site, result, at) => call('POST', '/issues', {
      title: issueTitle(site),
      labels: [LABEL],
      body: `${marker(site.url)}\n**${site.name}** não respondeu como esperado.\n\n- Endereço: ${site.url}\n- Problema: ${result.error}\n- Detectado em: ${at}\n\nEste aviso fecha sozinho quando o site voltar.`,
    }),
    comment: (number, text) => call('POST', `/issues/${number}/comments`, { body: text }),
    close: number => call('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'completed' }),
  };
}

export async function run({ sites, prevStatus, gh, fetchImpl = fetch, now = new Date(), timeoutMs, retryDelayMs }) {
  const results = [];
  for (const site of sites) results.push({ site, result: await checkSite(site, { fetchImpl, timeoutMs, retryDelayMs }) });
  const actions = decide(results, await gh.listOpenIssues());
  const at = now.toISOString();
  for (const action of actions) {
    if (action.type === 'open') await gh.openIssue(action.site, action.result, at);
    else {
      await gh.comment(action.number, `O site voltou a responder em ${at} (HTTP ${action.result.status}). Fechando este aviso.`);
      await gh.close(action.number);
    }
  }
  return { results, actions, ...nextStatus(prevStatus, results, now) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    console.error('GITHUB_TOKEN and GITHUB_REPOSITORY are required (the workflow sets both).');
    process.exit(1);
  }
  const { sites } = JSON.parse(readFileSync(new URL('./sites.json', import.meta.url), 'utf8'));
  let prevStatus = { heartbeatAt: null, sites: {} };
  try {
    prevStatus = JSON.parse(readFileSync(new URL('./status.json', import.meta.url), 'utf8'));
  } catch {
    // first run: no status yet
  }
  const out = await run({ sites, prevStatus, gh: github({ token, repository }) });
  for (const { site, result } of out.results) console.log(`${result.ok ? 'OK  ' : 'DOWN'} ${site.url} ${result.error || result.status}`);
  if (out.write) writeFileSync(new URL('./status.json', import.meta.url), JSON.stringify(out.status, null, 2) + '\n');
}
