// Renders one badge per state with sample results (MV3 forbids inline scripts).
const SAMPLES = [
  {
    badge: 'green', emoji: '🟢', label: 'Likely real', score: 4,
    officialUrl: 'https://boards.greenhouse.io/example/jobs/1',
    reasons: [
      { id: 'found', polarity: 'positive', text: "This job is listed on the company's own careers site." },
      { id: 'pay', polarity: 'positive', text: 'The posting states a pay range.' },
      { id: 'reposted', polarity: 'negative', text: 'The posting dates disagree: LinkedIn (reposted) shows it 1 days ago, Workable · example 1000 days ago.' },
    ],
    signals: { reposted_to_look_new: true },
    checks: [
      { label: 'Apply page on careers.example.com', status: 'found', detail: '' },
      { label: 'Job search on careers.example.com', status: 'found', detail: '' },
      { label: 'Workable · example', status: 'unknown', detail: '' },
      { label: 'Sitemap of careers.example.com', status: 'skipped', detail: '' },
    ],
    dates: [
      { source: 'LinkedIn (reposted)', date: '2026-10-23', days: 1 },
      { source: 'Job search on careers.example.com', date: '2026-10-23', days: 1 },
      { source: 'Workable · example', date: '2024-01-28', days: 1000 },
    ],
  },
  {
    badge: 'yellow', emoji: '🟡', label: 'Questionable', score: 0,
    reasons: [
      { id: 'found', polarity: 'positive', text: "This job is listed on the company's own careers site." },
      { id: 'old', polarity: 'negative', text: 'It has been open for more than 90 days.' },
    ],
  },
  {
    badge: 'red', emoji: '🔴', label: 'Suspicious', score: -4,
    reasons: [
      { id: 'missing', polarity: 'negative', text: "We could not find this job on the company's careers site." },
      { id: 'template', polarity: 'negative', text: 'The description reads like a generic template.' },
    ],
  },
  {
    badge: 'unknown', emoji: '⚪', label: "Can't verify", score: null,
    reasons: [{ id: 'unknown', polarity: 'neutral', text: "We couldn't reach the company's careers site." }],
  },
];

const uis = [];
for (const sample of SAMPLES) {
  const row = document.createElement('div');
  row.className = 'row';
  row.textContent = 'Example Job Title';
  document.getElementById('rows').append(row);
  const ui = new globalThis.GhostCheckUI({ onRecheck: () => alert('Recheck clicked') });
  ui.attach(row);
  ui.setResult({ officialUrl: null, detected: {}, checkedAt: new Date().toISOString(), ...sample });
  uis.push({ ui, row, sample });
}

document.getElementById('dark').addEventListener('change', (e) => {
  document.documentElement.classList.toggle('theme--dark', e.target.checked);
  document.body.style.background = e.target.checked ? '#1b1f23' : '';
  document.body.style.color = e.target.checked ? '#eee' : '';
  for (const { ui, row, sample } of uis) {
    ui.remove();
    ui.attach(row);
    ui.setResult({ officialUrl: null, detected: {}, ...sample });
  }
});

// Results open their card on arrival on LinkedIn; show that for the first one.
uis[0].ui.openCard({ fresh: true });
