/**
 * When LinkedIn says the job was posted, from the line under the title:
 * "Tokyo, Japan · Reposted 2 weeks ago · 83 applicants",
 * "東京都 · 2週間前に再投稿 · 応募者83人", "上海 · 1 周前重新发布 · 50 位申请者".
 * Relative dates are approximate (LinkedIn rounds), so callers use generous
 * margins.
 */

const UNIT_DAYS = [
  [/^(?:second|minute|hour|秒|分|小时|小時|時間)/i, 0],
  [/^(?:day|天|日)/i, 1],
  [/^(?:week|周|週|星期)/i, 7],
  [/^(?:month|个月|個月|か月|ヶ月|ヵ月|カ月|月)/i, 30],
  [/^(?:year|年)/i, 365],
];
const REPOSTED = /\breposted\b|重新发布|重新發佈|重新發布|再投稿|再掲載/i;
const JUST_NOW = /\bjust now\b|刚刚|剛剛|たった今/i;

/**
 * @param {string} metaText
 * @returns {{ days: number, reposted: boolean } | null}  null when no date is shown
 */
export function parseLinkedInPosted(metaText) {
  const parts = String(metaText || '').split('·').map((s) => s.trim());
  for (const part of parts) {
    if (JUST_NOW.test(part)) return { days: 0, reposted: REPOSTED.test(part) };
    // "2 weeks ago", "2週間前", "1 个月前", "an hour ago"
    const m = part.match(/(\d+|an?|one)\s*([a-z]+|[^\d\s]{1,3})\s*(?:ago|前)/i);
    if (!m) continue;
    const unit = UNIT_DAYS.find(([re]) => re.test(m[2]));
    if (!unit) continue;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
    return { days: n * unit[1], reposted: REPOSTED.test(part) };
  }
  return null;
}
