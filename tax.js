// 예상 세금 계산 (2026년 귀속 기준). 브라우저와 node(tax_test.js) 양쪽에서 쓴다.
// 근거(2026-10-10 법령 원문 대조): 소득세법 55조, 법인세법 55조(2026.1.1 시행 10/20/22/25%),
// 부가세법 42조(의제매입), 46조(신용카드 발행세액공제 2026.12.31까지 1.3%·연 1천만원), 63조·69조, 시행령 111조②.
// 단순화(화면에도 표시): 의제매입 한도(령 84조)·감가상각·세액공제감면·최저한세·가산세는 반영하지 않는다.
const Tax = (() => {
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

  return { VA_RATE, incomeTax, corpTax, vatGeneral, vatSimple, income, corp };
})();
if (typeof module !== 'undefined') module.exports = Tax;
