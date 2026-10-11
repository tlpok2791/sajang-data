// 예상 세금 계산 (2026년 귀속 기준). 브라우저와 node(tax_test.js) 양쪽에서 쓴다.
// 근거(2026-10-10 법령 원문 대조): 소득세법 55조, 법인세법 55조(2026.1.1 시행 10/20/22/25%),
// 부가세법 42조(의제매입), 46조(신용카드 발행세액공제 2026.12.31까지 1.3%·연 1천만원), 63조·69조, 시행령 111조②.
// 단순화(화면에도 표시): 의제매입 한도(령 84조)·감가상각·세액공제감면·최저한세·가산세는 반영하지 않는다.
const Tax = (() => {
  const { WHT_ROWS, WHT_10M } = typeof module !== 'undefined' ? require('./wht_table.js') : globalThis;
  const VA_RATE = { 음식점업: .15, 소매업: .15, 제조업: .20, 숙박업: .25, '건설·운수·정보통신': .30, '금융·전문서비스·부동산': .40, '그 밖의 서비스업': .30 };

  function progressive(base, table) {           // table: [[상한, 누적세액, 초과분 세율]] 오름차순
    if (base <= 0) return 0;
    let lo = 0;
    for (const [hi, cum, r] of table) {           // 마지막 구간 상한이 Infinity라 반드시 여기서 끝난다
      if (base <= hi) return cum + (base - lo) * r;
      lo = hi;
    }
  }
  // [구간 상한, 구간 하한까지의 누적세액, 세율]
  const INCOME = [[14e6, 0, .06], [50e6, 84e4, .15], [88e6, 624e4, .24], [150e6, 1536e4, .35], [300e6, 3706e4, .38], [500e6, 9406e4, .40], [1e9, 17406e4, .42], [Infinity, 38406e4, .45]];
  const GIFT = [[1e8, 0, .10], [5e8, 1e7, .20], [10e8, 9e7, .30], [30e8, 2.4e8, .40], [Infinity, 10.4e8, .50]];   // 상증법 26조
  const CORP = [[2e8, 0, .10], [200e8, 2e7, .20], [3000e8, 39.8e8, .22], [Infinity, 655.8e8, .25]];
  const CORP_SMALL_RENT = [[200e8, 0, .20], [3000e8, 40e8, .22], [Infinity, 656e8, .25]];   // 법인세법 60조의2①1 성실신고확인 대상 소규모 법인

  const incomeTax = base => Math.floor(progressive(base, INCOME));
  const corpTax = (base, smallRent) => Math.floor(progressive(base, smallRent ? CORP_SMALL_RENT : CORP));

  // 한 과세기간(반기) 부가세. m = 그 기간 월별 합계 {sales, card, buyTax, buyFree}. 모두 공급가액(부가세 제외) 원.
  function vatGeneral(m, { kind, industry, cardUsed = 0 }) {
    const out = Math.round(m.sales * .1), inp = Math.round(m.buyTax * .1);
    let deemed = 0, deemedRate = '';
    if (industry === '음식점업' && m.buyFree > 0) {
      const [n, d] = kind === '법인' ? [6, 106] : (m.sales <= 2e8 ? [9, 109] : [8, 108]);
      deemed = Math.floor(m.buyFree * n / d); deemedRate = `${n}/${d}`;
    }
    const payable = out - inp - deemed;
    let card = 0;
    if (kind === '개인' && payable > 0) card = Math.min(Math.floor(m.card * 1.1 * .013), 1e7 - cardUsed, payable);
    return { out, inp, deemed, deemedRate, card, tax: payable - card };
  }

  // 간이과세자는 1년이 한 과세기간. sales·buyTax는 공급가액으로 받아 공급대가(×1.1)로 바꾼다.
  function vatSimple(y, { industry }) {
    const supply = Math.round(y.sales * 1.1), rate = VA_RATE[industry] ?? .30;
    if (supply < 48e6) return { supply, rate, exempt: true, tax: 0 };
    const gross = Math.floor(supply * rate * .1), buy = Math.floor(y.buyTax * 1.1 * .005);
    const card = Math.min(Math.floor(y.card * 1.1 * .013), 1e7, Math.max(0, gross - buy));
    return { supply, rate, gross, buy, card, exempt: false, tax: Math.max(0, gross - buy - card) };
  }

  // 종소세: 사업소득금액 = 매출 - 경비(과세매입+면세매입+인건비+기타). 기본공제 150만원 × 인원.
  function income(y, { people = 1, otherDeduct = 0, prepaid = 0 }) {
    const profit = y.sales - y.buyTax - y.buyFree - y.labor - y.other;
    const base = Math.max(0, profit - 150e4 * people - otherDeduct);
    const tax = incomeTax(base), local = Math.floor(tax * .1);
    return { profit, base, tax, local, total: tax + local, due: tax + local - prepaid };
  }

  function corp(y, { lossCarry = 0, smallRent = false, prepaid = 0 }) {
    const profit = y.sales - y.buyTax - y.buyFree - y.labor - y.other;
    const base = Math.max(0, profit - Math.min(lossCarry, Math.max(0, profit)));
    const tax = corpTax(base, smallRent), local = Math.floor(tax * .1);   // 법인지방소득세는 근사(산출세액의 10%)
    return { profit, base, tax, local, total: tax + local, due: tax + local - prepaid };
  }

  // 4대보험 (2026년, 월 보수 기준). 근거: 국민연금법 부칙(2026 9.5%)·2026.7 기준소득월액 41만~659만원,
  // 국민건강보험법 시행령 44조(7.19%), 노인장기요양보험법 시행령 4조(보수의 0.9448%), 고용보험료징수법 시행령 12조.
  // 단순화: 건강보험 보수월액 상·하한, 두루누리 지원, 비과세 판단은 반영하지 않는다. 각 보험료는 10원 미만 절사.
  const STAB = { lt150: .0025, priority: .0045, lt1000: .0065, ge1000: .0085 };   // 고용안정·직업능력개발(사업주만)
  const PENSION_MIN = 41e4, PENSION_MAX = 659e4;
  function insurance(pay, { size = 'lt150', injury = 0 } = {}) {
    const f10 = x => Math.floor(x / 10 + 1e-7) * 10;      // 300만×0.9%=26999.999… 같은 소수점 오차 보정 후 10원 미만 절사
    const base = Math.min(PENSION_MAX, Math.max(PENSION_MIN, Math.floor(pay / 1000) * 1000));
    const rows = [
      ['국민연금 (9.5%)', f10(base * .0475), f10(base * .0475)],
      ['건강보험 (7.19%)', f10(pay * .03595), f10(pay * .03595)],
      ['장기요양 (0.9448%)', f10(pay * .004724), f10(pay * .004724)],
      ['고용보험', f10(pay * .009), f10(pay * (.009 + STAB[size]))],
      ['산재보험', 0, f10(pay * injury)],
    ];
    const worker = rows.reduce((s, r) => s + r[1], 0), employer = rows.reduce((s, r) => s + r[2], 0);
    return { pensionBase: base, rows, worker, employer, net: pay - worker };
  }

  // 근로소득 원천징수(매월) — 간이세액표. pay: 월급여(비과세 제외, 원), family: 공제대상가족 수(본인 포함), kids: 8~20세 자녀 수
  function withholding(pay, family = 1, kids = 0) {
    const k = pay / 1000, col = f => {                                 // 가족 수별 세액 (11명 초과는 별표 2 제4호)
      const at = r => f <= 11 ? r[f - 1] : Math.max(0, r[10] - (r[9] - r[10]) * (f - 11));
      if (k < 770) return 0;
      if (k < 10000) return at(WHT_ROWS.find(r => k >= r[0] && k < r[1]).slice(2));
      const base = at(WHT_10M), x = pay - 1e7;                         // 1,000만원 초과: 별표 2 계산식
      if (k <= 10000) return base;                                    // 정확히 1,000만원은 '10,000천원' 행
      if (k <= 14000) return base + x * .98 * .35 + 25000;
      if (k <= 28000) return base + 1397000 + (pay - 14e6) * .98 * .38;
      if (k <= 30000) return base + 6610600 + (pay - 28e6) * .98 * .40;
      if (k <= 45000) return base + 7394600 + (pay - 30e6) * .40;
      if (k <= 87000) return base + 13394600 + (pay - 45e6) * .42;
      return base + 31034600 + (pay - 87e6) * .45;
    };
    const kidCut = kids <= 0 ? 0 : kids === 1 ? 20830 : 45830 + 33330 * (kids - 2);
    const tax = Math.max(0, Math.floor((col(Math.max(1, family)) - kidCut) / 10 + 1e-7) * 10);   // 10원 미만 절사
    return { tax, local: Math.floor(tax * .1 / 10 + 1e-7) * 10 };
  }

  // ── 양도소득세 (부동산) — 소득세법 89·95·103·104조, 지방소득세 10%(지방세법 103조의3) ──
  // kind: 'house' | 'land' | 'building'. 1세대1주택 비과세 요건 충족 여부와 다주택 중과 해당 여부는 사용자가 판단해 넣는다.
  function transferTax({ price, cost, expense = 0, years = 0, resYears = 0, kind = 'house', oneHouse = false, heavy = 0, nonBizLand = false, basicUsed = false }) {
    let gain = Math.max(0, price - cost - expense), exemptPart = 0;
    if (kind === 'house' && oneHouse) {
      if (price <= 12e8) return { gain, exempt: true, base: 0, tax: 0, local: 0, total: 0, note: '1세대1주택 12억원 이하 비과세' };
      exemptPart = gain - Math.floor(gain * (price - 12e8) / price);        // 12억 초과분만 과세 (소득세법 95조③)
      gain -= exemptPart;
    }
    let ltRate = 0;                                                         // 장기보유특별공제 (95조②)
    if (years >= 3 && !(kind === 'house' && heavy)) {
      if (kind === 'house' && oneHouse && resYears >= 2)                   // 표2: 보유 4%/년 + 거주 4%/년(2년 8%), 각 40% 한도
        ltRate = Math.min(.40, .04 * Math.floor(years)) + Math.min(.40, Math.floor(resYears) === 2 ? .08 : .04 * Math.floor(resYears));
      else ltRate = Math.min(.30, .02 * Math.floor(years));                 // 표1: 3년 6% + 1년마다 2%, 30% 한도
    }
    const lt = Math.floor(gain * ltRate), income = gain - lt;
    const base = Math.max(0, income - (basicUsed ? 0 : 250e4));             // 양도소득 기본공제 연 250만원 (103조)
    const basic = b => incomeTax(b), extra = (heavy ? heavy / 100 : 0) + (nonBizLand ? .10 : 0);
    const prog = Math.floor(basic(base) + base * extra);                    // 기본세율(+중과 가산)
    const short = years < 1 ? (kind === 'house' ? .70 : .50) : years < 2 ? (kind === 'house' ? .60 : .40) : 0;
    const tax = short ? Math.max(Math.floor(base * short), extra ? prog : 0) : prog;   // 2년 미만은 단기세율(중과면 큰 것)
    const local = Math.floor(tax * .1);
    return { gain, exemptPart, ltRate, lt, income, base, rateNote: short ? `단기 ${short * 100}%` : `기본세율${extra ? ` +${Math.round(extra * 100)}%p` : ''}`, tax, local, total: tax + local };
  }

  // ── 증여세 — 상증법 26·53·53의2·55·57·58·69조. amount: 이번 증여, prior: 같은 증여자로부터 10년 내 증여(합산) ──
  const GIFT_LIMIT = { spouse: 6e8, up: 5e7, upMinor: 2e7, down: 5e7, relative: 1e7, other: 0 };
  function giftTax({ amount, relation = 'up', prior = 0, priorTax = 0, usedDeduct = 0, marriage = false, skipGen = false, minor = false }) {
    const value = amount + prior;
    let ded = Math.max(0, Math.min(GIFT_LIMIT[relation] - usedDeduct, value));
    if (marriage && (relation === 'up' || relation === 'upMinor')) ded = Math.min(value, ded + 1e8);   // 혼인·출산 공제 1억
    const base = value - ded;
    if (base < 50e4) return { value, ded, base, tax: 0, total: 0, note: '과세표준 50만원 미만 — 과세하지 않음' };
    const calc = Math.floor(progressive(base, GIFT));
    const surcharge = skipGen ? Math.floor(calc * (minor && amount > 20e8 ? .40 : .30)) : 0;         // 세대생략 할증
    const afterPrior = Math.max(0, calc + surcharge - priorTax);
    const report = Math.floor(afterPrior * .03);                             // 신고세액공제 3%
    return { value, ded, base, calc, surcharge, priorTax, report, tax: afterPrior - report, total: afterPrior - report };
  }

  // ── 상속세 — 상증법 18~22·24~26·69조 (단순화: 동거주택·가업·영농 공제, 공제 종합한도의 세부는 제외) ──
  function inheritTax({ estate, debts = 0, funeral = 5e6, priorGifts = 0, priorGiftTax = 0, spouse = false, spouseGets = 0, kids = 0, minorYears = 0, elderly = 0, finNet = 0 }) {
    const value = Math.max(0, estate - debts - Math.min(Math.max(funeral, 5e6), 15e6) + priorGifts);
    const personal = Math.max(5e8, 2e8 + 5e7 * kids + 1e7 * minorYears + 5e7 * elderly);    // 일괄공제 5억 vs 기초+기타인적
    const spouseShare = 1.5 / (1.5 + Math.max(kids, 0));                     // 배우자 법정상속분(자녀 수 기준 근사)
    const spouseDed = spouse ? Math.max(5e8, Math.min(spouseGets, Math.floor((estate - debts) * spouseShare), 30e8)) : 0;
    const fin = finNet <= 0 ? 0 : finNet <= 2e7 ? finNet : Math.min(2e8, Math.max(finNet * .2, 2e7));
    const ded = Math.min(personal + spouseDed + fin, Math.max(0, value - priorGifts));          // 공제 종합한도(사전증여분은 공제 못 받음)
    const base = value - ded;
    if (base < 50e4) return { value, personal, spouseDed, fin, ded, base, tax: 0, total: 0, note: '과세표준 50만원 미만 — 과세하지 않음' };
    const calc = Math.floor(progressive(base, GIFT));
    const afterPrior = Math.max(0, calc - priorGiftTax);
    const report = Math.floor(afterPrior * .03);
    return { value, personal, spouseDed, fin, ded, base, calc, priorGiftTax, report, tax: afterPrior - report, total: afterPrior - report };
  }

  // ── 주민세 사업소분 — 지방세법 81조 (조례로 ±50% 가감 가능) ──
  function residentBiz({ kind = '개인', capital = 0, area = 0, polluting = false }) {
    const basic = kind === '법인' ? (capital > 50e8 ? 2e5 : capital > 30e8 ? 1e5 : 5e4) : 5e4;
    const byArea = area > 330 ? Math.floor(area * (polluting ? 500 : 250)) : 0;                 // 연면적 330㎡ 초과 사업소만
    return { basic, byArea, total: basic + byArea };
  }

  // 사업자등록번호 검증번호(10번째 자리) — 가중치 1,3,7,1,3,7,1,3,5 + 9번째×5의 십의 자리
  function bizNoValid(no) {
    const d = String(no).replace(/\D/g, '');
    if (d.length !== 10) return false;
    const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    let s = w.reduce((a, x, i) => a + x * +d[i], 0) + Math.floor(+d[8] * 5 / 10);
    return (10 - s % 10) % 10 === +d[9];
  }

  return { VA_RATE, incomeTax, corpTax, vatGeneral, vatSimple, income, corp, insurance, withholding, transferTax, giftTax, inheritTax, residentBiz, bizNoValid };
})();
if (typeof module !== 'undefined') module.exports = Tax;
