/**
 * Job boards, aggregators and recruitment agencies. An apply link to one of
 * these is not the company's own careers site: a listing there does not show
 * the company is hiring, and a removed listing does not show it stopped.
 *
 * To add a site: append an entry. `domains` match the host and its
 * subdomains (liepin.com matches www.liepin.com); `brands` match the brand
 * under any country domain (michaelpage matches michaelpage.co.jp).
 */

/** @typedef {{ name: string, native?: string, domains?: string[], brands?: string[] }} JobBoard */

/** @type {JobBoard[]} */
export const JOB_BOARDS = [
  // China
  { name: 'Liepin', native: '猎聘', domains: ['liepin.com'] },
  { name: 'BOSS Zhipin', native: 'BOSS直聘', domains: ['zhipin.com'] },
  { name: 'Zhaopin', native: '智联招聘', domains: ['zhaopin.com'] },
  { name: '51job', native: '前程无忧', domains: ['51job.com'] },
  { name: 'Lagou', native: '拉勾', domains: ['lagou.com'] },
  { name: 'Maimai', native: '脉脉', domains: ['maimai.cn'] },
  { name: 'Shixiseng', native: '实习僧', domains: ['shixiseng.com'] },
  { name: 'Nowcoder', native: '牛客', domains: ['nowcoder.com'] },
  { name: 'Kanzhun', native: '看准', domains: ['kanzhun.com'] },
  { name: 'Yingjiesheng', native: '应届生求职网', domains: ['yingjiesheng.com'] },
  { name: 'ChinaHR', native: '中华英才网', domains: ['chinahr.com'] },
  { name: 'Dajie', native: '大街网', domains: ['dajie.com'] },
  { name: '58.com', native: '58同城', domains: ['58.com'] },
  // Japan
  { name: 'doda', domains: ['doda.jp'] },
  { name: 'Rikunabi', native: 'リクナビ', domains: ['rikunabi.com'] },
  { name: 'en-japan', native: 'エン・ジャパン', domains: ['en-japan.com'] },
  { name: 'Mynavi', native: 'マイナビ', domains: ['mynavi.jp'] },
  { name: 'Wantedly', domains: ['wantedly.com'] },
  { name: 'BizReach', native: 'ビズリーチ', domains: ['bizreach.jp'] },
  { name: 'Green', domains: ['green-japan.com'] },
  { name: 'type', domains: ['type.jp'] },
  { name: 'Daijob', domains: ['daijob.com'] },
  { name: 'CareerCross', domains: ['careercross.com'] },
  { name: 'JAC Recruitment', domains: ['jac-recruitment.jp', 'jac-recruitment.com'] },
  // Korea, Taiwan, rest of Asia-Pacific
  { name: 'Saramin', native: '사람인', domains: ['saramin.co.kr'] },
  { name: 'JobKorea', native: '잡코리아', domains: ['jobkorea.co.kr'] },
  { name: 'Wanted', domains: ['wanted.co.kr'] },
  { name: '104', native: '104人力銀行', domains: ['104.com.tw'] },
  { name: '1111', native: '1111人力銀行', domains: ['1111.com.tw'] },
  { name: 'Cake', domains: ['cake.me', 'cakeresume.com'] },
  { name: 'JobStreet', brands: ['jobstreet'] },
  { name: 'JobsDB', brands: ['jobsdb'] },
  { name: 'Seek', domains: ['seek.com.au', 'seek.co.nz'] },
  { name: 'Naukri', domains: ['naukri.com'] },
  { name: 'foundit', domains: ['foundit.in', 'foundit.sg', 'foundit.hk', 'monsterindia.com'] },
  // Europe
  { name: 'StepStone', brands: ['stepstone'] },
  { name: 'XING', domains: ['xing.com'] },
  { name: 'Reed', domains: ['reed.co.uk'] },
  { name: 'Totaljobs', domains: ['totaljobs.com'] },
  { name: 'CWJobs', domains: ['cwjobs.co.uk'] },
  { name: 'jobs.ch', domains: ['jobs.ch', 'jobup.ch'] },
  { name: 'HelloWork', domains: ['hellowork.com'] },
  { name: 'Welcome to the Jungle', domains: ['welcometothejungle.com'] },
  { name: 'APEC', domains: ['apec.fr'] },
  { name: 'InfoJobs', brands: ['infojobs'] },
  { name: 'Jobindex', domains: ['jobindex.dk'] },
  { name: 'Otta', domains: ['otta.com'] },
  // Global and North America
  { name: 'Indeed', brands: ['indeed'] },
  { name: 'Glassdoor', brands: ['glassdoor'] },
  { name: 'ZipRecruiter', brands: ['ziprecruiter'] },
  { name: 'Monster', brands: ['monster'] },
  { name: 'Dice', domains: ['dice.com'] },
  { name: 'SimplyHired', brands: ['simplyhired'] },
  { name: 'CareerBuilder', brands: ['careerbuilder'] },
  { name: 'Wellfound', domains: ['wellfound.com', 'angel.co'] },
  { name: 'Built In', domains: ['builtin.com'] },
  { name: 'Y Combinator', domains: ['workatastartup.com'] },
  { name: 'Remote OK', domains: ['remoteok.com'] },
  { name: 'We Work Remotely', domains: ['weworkremotely.com'] },
  { name: 'Jooble', brands: ['jooble'] },
  { name: 'Talent.com', domains: ['talent.com'] },
  { name: 'Adzuna', brands: ['adzuna'] },
  { name: 'Jobrapido', brands: ['jobrapido'] },
  { name: 'eFinancialCareers', brands: ['efinancialcareers'] },
  { name: 'hiring.cafe', domains: ['hiring.cafe'] },
  // Recruitment agencies
  { name: 'Robert Walters', brands: ['robertwalters'] },
  { name: 'Michael Page', brands: ['michaelpage'] },
  { name: 'PageGroup', brands: ['pagepersonnel', 'pageexecutive'] },
  { name: 'Hays', brands: ['hays'] },
  { name: 'Robert Half', brands: ['roberthalf'] },
  { name: 'Randstad', brands: ['randstad'] },
  { name: 'Adecco', brands: ['adecco'] },
  { name: 'ManpowerGroup', brands: ['manpower', 'manpowergroup'] },
  { name: 'Kelly', brands: ['kellyservices'] },
  { name: 'PERSOLKELLY', brands: ['persolkelly'] },
  { name: 'Hudson', brands: ['hudsonrpo'] },
];

/** Letters and digits only, lowercase: "Robert Walters" -> "robertwalters". */
const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * @param {string | null | undefined} rawUrl  the apply link
 * @param {string} [company]  the hiring company: an agency's own jobs are on its own site
 * @returns {JobBoard | null}
 */
export function detectJobBoard(rawUrl, company = '') {
  let host;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  const labels = host.split('.');
  const board = JOB_BOARDS.find(
    (b) =>
      (b.domains || []).some((d) => host === d || host.endsWith(`.${d}`)) ||
      // the brand is a label followed only by a country/generic suffix (≤ 2 short labels)
      (b.brands || []).some((brand) => {
        const i = labels.lastIndexOf(brand);
        return i >= 0 && labels.length - i - 1 >= 1 && labels.slice(i + 1).every((l) => l.length <= 3);
      }),
  );
  if (!board) return null;
  // Randstad hiring for itself on randstad.com is the company's own site.
  const who = squash(company);
  if (who && [board.name, ...(board.brands || [])].some((n) => who.includes(squash(n)))) return null;
  return board;
}

/** Name to show: the native name in Chinese, both otherwise. */
export function jobBoardName(board, lang) {
  if (!board.native) return board.name;
  return lang === 'zh' ? board.native : `${board.name} (${board.native})`;
}
