// Renders one badge per state with sample results (MV3 forbids inline scripts).
const SAMPLES = [
  {
    badge: 'green', emoji: '🟢', label: 'Likely real', score: 4,
    officialUrl: 'https://boards.greenhouse.io/example/jobs/1',
    reasons: [
      { id: 'found', polarity: 'positive', text: "This job is listed on the company's own careers site." },
      { id: 'fresh', polarity: 'positive', text: 'It first appeared in the last 30 days.' },
      { id: 'pay', polarity: 'positive', text: 'The posting states a pay range.' },
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
  ui.setResult({ officialUrl: null, detected: {}, ...sample });
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
