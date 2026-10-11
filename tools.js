// 사장님 계산기 — 정의만 둔다. 화면은 index.html의 drawTool()이 그린다.
// native 항목은 화면이 따로 있는 계산기(급여·양도·상증) — 목록에만 올린다.
// f: [키, 라벨, 기본값, 단위('원'|'%'|그 밖 글자) 또는 select 목록 배열 또는 'text'|'date']
// run(v) → { k: [[라벨, 값]] 핵심 3개 이하, r: [[라벨, 값]] 세부, n: 주석, doc: 인쇄용 html }
const Tools = (() => {
  const T = typeof Tax !== 'undefined' ? Tax : require('./tax.js');
  const W = n => Math.round(n).toLocaleString('ko-KR') + '원', P = n => (Math.round(n * 10) / 10).toLocaleString('ko-KR') + '%';
  const N = (n, u = '') => (Math.round(n * 10) / 10).toLocaleString('ko-KR') + u;
  const MIN_WAGE = 10320;                     // 2026년 최저임금 (고용노동부 고시, 2026.1.1~)
  const CARD = { '3억 이하': [0.40, 0.15], '3억~5억': [1.00, 0.75], '5억~10억': [1.15, 0.90], '10억~30억': [1.45, 1.15] };   // 우대수수료율 %, 신용·체크 (금융위 2025.2.14~)
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const weekly = (wage, hours) => hours >= 15 ? wage * Math.min(hours / 40, 1) * 8 : 0;   // 근로기준법 제55조, 시행령 제30조: 주 15시간 이상, 1주 소정근로시간/40×8
  const loan = (p, rate, n, kind) => {
    const r = rate / 1200; let bal = p, interest = 0, first = 0;
    for (let i = 1; i <= n; i++) {
      const it = bal * r, pr = kind === '원리금균등' ? (r ? p * r / (1 - (1 + r) ** -n) - it : p / n) : kind === '원금균등' ? p / n : (i === n ? p : 0);
      if (i === 1) first = it + pr;
      interest += it; bal -= pr;
    }
    return { first, interest };
  };
  const wht = (kind, amt, days = 1) => {      // 소득세법 제129조(세율)·제84조(과세최저한)·제86조(소액부징수), 지방소득세 10%
    const dn = x => Math.floor(x / 10) * 10;
    if (kind === '사업소득 3.3%') { const t = dn(amt * .03); return { tax: t, local: dn(t * .1) }; }
    if (kind.startsWith('기타소득')) {
      const inc = kind.includes('60%') ? amt * .4 : amt;
      if (inc <= 5e4) return { tax: 0, local: 0, note: '기타소득금액 5만원 이하 — 과세최저한(제84조)' };
      const t = dn(inc * .2); return t < 1000 ? { tax: 0, local: 0, note: '1천원 미만 소액부징수' } : { tax: t, local: dn(t * .1) };
    }
    const per = Math.max(0, amt - 15e4), t = dn(per * .06 * .45);   // 일용: 일 15만원 공제(제47조②) × 6% − 산출세액 55% 공제(제59조③), 하루 단위
    return t < 1000 ? { tax: 0, local: 0, note: '하루 세액 1천원 미만 — 소액부징수' } : { tax: t * days, local: dn(t * .1) * days };
  };
  // ── 인건비: 퇴직금·연장수당·4대보험 판정·연차 (2026-10-11 법령 원문 대조) ──
  const day = s => { const [y, m, d] = String(s || '').split('-').map(Number); return y && m && d ? Date.UTC(y, m - 1, d) : NaN; };
  const DAY = 864e5;
  const addMonths = (t, k) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, d.getUTCDate()); };
  // 통상임금 — 근로기준법 시행령 제6조: 월급 ÷ 월 기준시간[(주 소정근로시간 + 유급 주휴시간) × 365/7 ÷ 12], 일급 = 시간급 × 1일 소정근로시간(③)
  // 정기상여금처럼 재직·근무일수 조건이 붙은 정기·일률 임금도 포함(대법원 2024.12.19. 2023다302838 전원합의체, 선고일 이후 산정분부터)
  const ordinary = ({ base = 0, fixed = 0, bonus = 0, hourly = 0, week = 40, dayH = 8 }) => {
    const paidWeek = week + (week >= 15 ? Math.min(week / 40, 1) * 8 : 0);   // 주휴는 주 15시간 이상만(제18조③)
    const monthH = Math.round(paidWeek * 365 / 7 / 12);                       // 주 40시간 → 209시간(고용노동부 산정 관행대로 반올림)
    const hour = hourly + (base + fixed + bonus / 12) / monthH;
    return { monthH, hour, day: hour * dayH };
  };
  // 소득세법 제48조(퇴직소득공제) · 제55조②(연분연승): 근속연수공제 → 환산급여(÷근속연수×12) → 환산급여공제 → 기본세율 → ÷12×근속연수
  const retireTax = (amt, years) => {
    const yc = years <= 5 ? 1e6 * years : years <= 10 ? 5e6 + 2e6 * (years - 5) : years <= 20 ? 15e6 + 2.5e6 * (years - 10) : 40e6 + 3e6 * (years - 20);
    const conv = Math.max(0, amt - Math.min(amt, yc)) / years * 12;
    const cd = conv <= 8e6 ? conv : conv <= 7e7 ? 8e6 + (conv - 8e6) * .6 : conv <= 1e8 ? 4520e4 + (conv - 7e7) * .55 : conv <= 3e8 ? 6170e4 + (conv - 1e8) * .45 : 15170e4 + (conv - 3e8) * .35;
    const base = Math.max(0, conv - cd);
    const tax = Math.floor(T.incomeTax(base) / 12 * years / 10) * 10;
    return { yc: Math.min(amt, yc), conv, cd, base, tax, local: Math.floor(tax * .1 / 10) * 10 };
  };
  // 근로자퇴직급여 보장법 제4조①(1년 미만·4주 평균 주 15시간 미만 제외), 제8조①(1년에 30일분 평균임금)
  // 근로기준법 제2조①6(평균임금 = 이전 3개월 임금총액 ÷ 그 기간 총일수), 같은 조②(통상임금보다 적으면 통상임금)
  const severance = ({ start, end, hours, wage3, bonus = 0, leavePay = 0, daily = 0, base = 0, fixed = 0, hourly = 0, dayH = 8 }) => {
    if (!daily && (base || fixed || hourly)) daily = ordinary({ base, fixed, bonus, hourly, week: hours, dayH }).day;
    const s0 = day(start), last = day(end);
    if (!(last >= s0)) return { error: '입사일과 마지막 근무일을 확인해 주세요.' };
    const quit = last + DAY, days = Math.round((quit - s0) / DAY);       // 퇴직일 = 마지막 근무일 다음 날
    if (days < 365) return { days, ok: false, why: '계속근로기간 1년 미만 — 퇴직금 지급 대상이 아닙니다(퇴직급여법 제4조①).' };
    if (hours < 15) return { days, ok: false, why: '4주 평균 1주 소정근로시간 15시간 미만 — 퇴직금 지급 대상이 아닙니다(퇴직급여법 제4조①).' };
    const p3 = Math.round((quit - addMonths(quit, -3)) / DAY);
    const avg0 = (wage3 + bonus * 3 / 12 + leavePay * 3 / 12) / p3, avg = Math.max(avg0, daily || 0);
    const pay = Math.floor(avg * 30 * days / 365);
    let years = new Date(quit).getUTCFullYear() - new Date(s0).getUTCFullYear(), dq = new Date(quit), ds = new Date(s0);
    if (Date.UTC(2000, dq.getUTCMonth(), dq.getUTCDate()) < Date.UTC(2000, ds.getUTCMonth(), ds.getUTCDate())) years--;
    if (addMonths(s0, years * 12) < quit) years++;                         // 1년 미만 기간은 1년(소득세법 제48조①)
    return { ok: true, days, p3, avg0, avg, pay, years, tx: retireTax(pay, years) };
  };
  // 근로기준법 제56조: 연장 50%, 휴일 8시간 이내 50%·초과 100%, 야간(22~06시) 50% / 상시 4명 이하는 제56조 미적용(시행령 별표 1)
  const overtime = ({ wage, five, ext = 0, night = 0, hol8 = 0, holOver = 0 }) => {
    const r = five ? 1 : 0;
    const base = wage * (ext + hol8 + holOver);                            // 일한 시간 자체의 임금(규모와 관계없이)
    const add = wage * r * (ext * .5 + night * .5 + hol8 * .5 + holOver * 1);
    return { base, add, total: base + add, rows: [['연장 가산(50%)', wage * r * ext * .5], ['야간 가산(50%)', wage * r * night * .5], ['휴일 8시간 이내 가산(50%)', wage * r * hol8 * .5], ['휴일 8시간 초과 가산(100%)', wage * r * holOver]] };
  };
  // 4대보험 적용 판정 — 국민연금법 제8조①(18세 이상 60세 미만)·시행령 제2조(월 60시간 미만 단시간·1개월 미만 일용 제외),
  // 국민건강보험법 제6조②1(1개월 미만 일용 제외)·시행령 제9조1(월 60시간 미만 단시간 제외),
  // 고용보험법 시행령 제3조(월 60시간 또는 주 15시간 미만 제외, 3개월 이상 계속·일용은 적용)·법 제10조(65세 이후 새로 고용되면 실업급여 미적용), 산재보험은 전부 적용
  const insCheck = ({ type, week, month, months, days = 0, age, pay, size = 'lt150', injury = 0 }) => {
    const mh = month || week * 365 / 7 / 12, day_ = type === '일용';
    const R = (on, why) => ({ on, why });
    const np = age >= 60 ? R(false, '60세 이상 — 사업장가입자 아님') : day_
      ? (months >= 1 && (days >= 8 || mh >= 60) ? R(true, '일용: 1개월 이상 계속 + 월 8일 또는 60시간 이상') : R(false, '일용: 1개월 미만이거나 월 8일·60시간 미만'))
      : mh < 60 ? R(false, '월 소정근로시간 60시간 미만 단시간근로자(3개월 이상 근로 시 본인 희망하면 가입 가능)') : R(true, '월 60시간 이상');
    const hi = day_ ? (months >= 1 ? R(true, '일용이라도 고용기간 1개월 이상') : R(false, '고용기간 1개월 미만 일용')) : mh < 60 ? R(false, '월 소정근로시간 60시간 미만 단시간근로자') : R(true, '월 60시간 이상');
    const ei = day_ ? R(true, '일용근로자는 근로시간과 관계없이 적용') : (mh < 60 || week < 15) && months < 3 ? R(false, '월 60시간 또는 주 15시간 미만(3개월 이상 계속 근로하면 적용)') : R(true, (mh < 60 || week < 15) ? '단시간이지만 3개월 이상 계속 근로' : '월 60시간·주 15시간 이상');
    const ins = T.insurance(pay, { size, injury }), f10 = x => Math.floor(x / 10 + 1e-7) * 10;
    const old = age >= 65 && ei.on && !day_;                               // 65세 이후 새로 고용: 실업급여분(각 0.9%) 없음, 사업주 고용안정분만 — 65세 전부터 가입 중이면 해당 없음
    const rows = [
      ['국민연금', np, ins.rows[0][1], ins.rows[0][2]],
      ['건강보험', hi, ins.rows[1][1], ins.rows[1][2]],
      ['장기요양', hi, ins.rows[2][1], ins.rows[2][2]],
      ['고용보험', ei, old ? 0 : ins.rows[3][1], old ? ins.rows[3][2] - f10(pay * .009) : ins.rows[3][2]],
      ['산재보험', R(true, '모든 근로자 적용(사업주 전액)'), 0, ins.rows[4][2]],
    ].map(([n, j, w, e]) => ({ n, ...j, w: j.on ? w : 0, e: j.on ? e : 0 }));
    return { mh, rows, worker: rows.reduce((a, r) => a + r.w, 0), employer: rows.reduce((a, r) => a + r.e, 0), old };
  };
  // 근로기준법 제60조: 1년 미만 1개월 개근마다 1일(최대 11일), 1년 80% 이상 출근 15일, 3년 이상 최초 1년 넘는 2년마다 1일 가산(최대 25일)
  // 제18조③ 주 15시간 미만 미적용, 시행령 별표 1 상시 4명 이하 미적용, 단시간은 통상근로자 시간 비례(제18조①·시행령 별표 2)
  const annualLeave = ({ start, base, five, week }) => {
    const s0 = day(start), b = day(base);
    if (!(b >= s0)) return { error: '입사일과 기준일을 확인해 주세요.' };
    if (!five) return { days: 0, why: '상시 4명 이하 사업장은 연차유급휴가 규정(제60조)이 적용되지 않습니다.' };
    if (week < 15) return { days: 0, why: '1주 소정근로시간 15시간 미만은 연차가 없습니다(제18조③).' };
    let m = 0; while (addMonths(s0, m + 1) <= b + DAY) m++;
    const y = Math.floor(m / 12);
    const days = y < 1 ? Math.min(11, m) : Math.min(25, 15 + Math.floor((y - 1) / 2));
    return { months: m, years: y, days, hours: days * 8 * Math.min(1, week / 40) };
  };
  const PAYSLIP = (v, ins, w) => `<h2 style="text-align:center">${esc(v.month)} 임금명세서</h2>
    <p>사업장: ${esc(v.biz)} · 성명: ${esc(v.name)} · 지급일: ${esc(v.payday)}</p>
    <table><tr><th>지급 항목</th><th>금액</th><th>공제 항목</th><th>금액</th></tr>
    ${(() => { const pay = [['기본급', v.base], ['연장·야간·휴일수당', v.ot], ['식대(비과세)', v.meal]], ded = [...ins.rows.map(r => [r[0], r[1]]), ['소득세', w.tax], ['지방소득세', w.local]];
      return Array.from({ length: Math.max(pay.length, ded.length) }, (_, i) => `<tr><td>${pay[i]?.[0] ?? ''}</td><td>${pay[i] ? W(pay[i][1]) : ''}</td><td>${ded[i]?.[0] ?? ''}</td><td>${ded[i] ? W(ded[i][1]) : ''}</td></tr>`).join(''); })()}
    <tr><th>지급 합계</th><th>${W(v.base + v.ot + v.meal)}</th><th>공제 합계</th><th>${W(ins.worker + w.tax + w.local)}</th></tr></table>
    <p><b>실지급액 ${W(v.base + v.ot + v.meal - ins.worker - w.tax - w.local)}</b></p>
    <p style="font-size:12px">계산 방법: 연장·야간·휴일수당 = 통상시급 × 해당 시간 × 1.5 (5인 이상 사업장). 4대보험은 비과세(식대)를 뺀 보수 기준.</p>`;
  const CONTRACT = v => `<h2 style="text-align:center">${v.type === '단시간' ? '단시간근로자 ' : ''}표준근로계약서</h2>
    <p>${esc(v.biz)}(이하 "사업주")과(와) ${esc(v.name)}(이하 "근로자")은 다음과 같이 근로계약을 체결한다.</p>
    <ol><li>근로개시일: ${esc(v.start)}부터${v.end ? ` ${esc(v.end)}까지` : ''}</li><li>근무 장소: ${esc(v.place)}</li><li>업무 내용: ${esc(v.job)}</li>
    <li>소정근로시간: ${esc(v.time)} (휴게시간 ${esc(v.rest)})</li><li>근무일·휴일: ${esc(v.days)}, 주휴일 ${esc(v.off)}</li>
    <li>임금: ${v.payType} ${W(v.wage)}${v.payType === '시급' ? ` (주휴수당 별도 지급, 2026년 최저임금 ${W(MIN_WAGE)} 이상)` : ''} · 매월 ${esc(v.payday)}일 근로자 명의 계좌로 지급</li>
    <li>연차유급휴가: 근로기준법에서 정하는 바에 따라 부여함</li><li>사회보험 적용: □고용보험 □산재보험 □국민연금 □건강보험</li>
    <li>근로계약서 교부: 사업주는 계약 체결과 동시에 본 계약서를 사본하여 근로자에게 교부함(근로기준법 제17조)</li>
    <li>기타: 이 계약에 정함이 없는 사항은 근로기준법령에 의함</li></ol>
    <p style="margin-top:24px">${new Date().getFullYear()}년 &nbsp;&nbsp;월 &nbsp;&nbsp;일</p>
    <p>(사업주) 사업체명: ${esc(v.biz)} &nbsp; 대표자: ${esc(v.ceo)} (서명)</p><p>(근로자) 성명: ${esc(v.name)} (서명)</p>`;

  const list = [
    ['배달', 'deliv', '배달가격 역산기', '배민에서 얼마에 팔아야 할까', [['net', '한 그릇에 남기고 싶은 금액(입금액)', 15000, '원'], ['fee', '중개수수료', 7.8, '%'], ['pay', '결제수수료', 3, '%'], ['ship', '사장님 부담 배달비', 2900, '원']],
      v => { const f = (v.fee + v.pay) / 100 * 1.1, price = (v.net + v.ship) / (1 - f), c = price * f;
        return { k: [['메뉴 가격', W(Math.ceil(price / 100) * 100)], ['수수료(부가세 포함)', W(c)], ['배달비 부담', W(v.ship)]], r: [['입금액 확인', W(price - c - v.ship)]], n: '수수료에는 부가세 10%가 붙는다고 보고 계산했습니다. 광고비·쿠폰은 따로 빼세요. 메뉴 가격은 100원 단위로 올림.' }; }],
    ['배달', 'coupon', '쿠폰·리뷰이벤트 계산기', '주문이 몇 % 늘어야 본전인가', [['price', '객단가', 20000, '원'], ['cost', '원가율(재료·포장)', 35, '%'], ['give', '쿠폰·서비스 1건 비용', 3000, '원'], ['orders', '지금 월 주문 수', 600, '건']],
      v => { const m = v.price * (1 - v.cost / 100), m2 = m - v.give, need = m2 > 0 ? (m / m2 - 1) * 100 : Infinity;
        return { k: [['본전 주문 증가율', isFinite(need) ? P(need) : '불가능(마진보다 쿠폰이 큼)'], ['본전 월 주문 수', isFinite(need) ? N(v.orders * m / m2, '건') : '-'], ['건당 마진 → 쿠폰 후', `${W(m)} → ${W(m2)}`]], r: [['지금 월 마진', W(m * v.orders)]], n: '모든 주문에 쿠폰이 쓰인다고 본 보수적 계산입니다.' }; }],
    ['가격', 'margin', '마진 계산기', '목표마진 남기려면 얼마에 팔까', [['cost', '원가', 6000, '원'], ['m', '목표 마진율(판매가 대비)', 30, '%'], ['vat', '부가세', ['판매가에 포함', '별도']]],
      v => { const sup = v.cost / (1 - v.m / 100), gross = v.vat === '판매가에 포함' ? sup * 1.1 : sup;
        return { k: [['판매가(손님 가격)', W(gross)], ['공급가액', W(sup)], ['마진', W(sup - v.cost)]], r: [['원가 대비 이익률(마크업)', P((sup / v.cost - 1) * 100)]], n: '마진율은 판매가 기준, 마크업은 원가 기준입니다. 두 숫자를 섞으면 가격을 낮게 잡게 됩니다.' }; }],
    ['가격', 'disc', '할인 계산기', '할인가·할인율과 마진 영향', [['price', '정가', 20000, '원'], ['cost', '원가', 8000, '원'], ['d', '할인율', 20, '%']],
      v => { const np = v.price * (1 - v.d / 100), m0 = v.price - v.cost, m1 = np - v.cost;
        return { k: [['할인가', W(np)], ['마진 변화', `${W(m0)} → ${W(m1)}`], ['같은 이익에 필요한 판매량', m1 > 0 ? N(m0 / m1, '배') : '불가능']], r: [['할인 후 마진율', P(m1 / np * 100)]], n: '' }; }],
    ['가격', 'raise', '가격 인상 손익 계산기', '손님이 몇 % 줄어도 괜찮을까', [['price', '지금 가격', 9000, '원'], ['cost', '원가', 3500, '원'], ['up', '인상률', 10, '%']],
      v => { const np = v.price * (1 + v.up / 100), m0 = v.price - v.cost, m1 = np - v.cost, ok = (1 - m0 / m1) * 100;
        return { k: [['새 가격', W(np)], ['손님이 이만큼 줄어도 본전', P(ok)], ['건당 마진', `${W(m0)} → ${W(m1)}`]], r: [], n: '고정비는 그대로라고 보고 마진 총액이 같아지는 지점을 계산했습니다.' }; }],
    ['가격', 'unit', '단가 계산기', '배송비·부가세까지 넣은 진짜 단가', [['total', '결제 금액(물건값)', 55000, '원'], ['ship', '배송비', 3000, '원'], ['qty', '수량', 20, '개'], ['vat', '결제 금액에 부가세', ['포함(세금계산서 받음)', '포함(공제 못 받음)', '면세품']]],
      v => { const all = v.total + v.ship, sup = v.vat === '포함(세금계산서 받음)' ? all / 1.1 : all;
        return { k: [['개당 진짜 단가', W(sup / v.qty)], ['총 원가', W(sup)], ['돌려받는 부가세', W(all - sup)]], r: [], n: '세금계산서·카드 매입은 부가세를 돌려받으니 공급가액이 원가입니다.' }; }],
    ['인건비', 'hourly', '시급·주휴수당 계산기', '일급·주급·월급과 주휴수당', [['wage', '시급', MIN_WAGE, '원'], ['h', '1주 근무시간', 20, '시간'], ['d', '1주 근무일', 5, '일']],
      v => { const wh = weekly(v.wage, v.h), wk = v.wage * v.h + wh;
        return { k: [['주휴수당 / 주', W(wh)], ['주급', W(wk)], ['월급(4.345주)', W(wk * 365 / 7 / 12)]], r: [['일급', W(v.wage * v.h / v.d)], ['주휴시간', N(v.h >= 15 ? Math.min(v.h / 40, 1) * 8 : 0, '시간')], ['최저임금 대비', v.wage >= MIN_WAGE ? '충족' : `부족 (2026년 ${W(MIN_WAGE)})`]],
          n: `근거: 근로기준법 제55조①·시행령 제30조(1주 소정근로일 개근 시 유급휴일), 제18조③(4주 평균 주 15시간 미만은 주휴 없음). 주휴는 상시 4명 이하 사업장에도 적용됩니다(시행령 별표 1). 2026년 최저임금 시급 ${W(MIN_WAGE)}. 연장·야간·휴일 가산은 \'연장·야간·휴일수당 계산기\'에서.` }; }],
    ['인건비', 'ordinary', '통상임금 계산기', '시간급·일급 — 수당·연차·퇴직금의 기준', [['base', '월 기본급(시급제는 0)', 2156880, '원'], ['fixed', '매월 고정수당(직책·자격·식대 등 모두에게 정기 지급)', 0, '원'], ['bonus', '1년간 정기상여금(재직·근무일수 조건이 있어도 포함)', 0, '원'], ['hourly', '시급제면 시급(월급제는 0)', 0, '원'], ['week', '1주 소정근로시간', 40, '시간'], ['dayH', '1일 소정근로시간', 8, '시간']],
      v => { const o = ordinary(v);
        return { k: [['통상임금 시간급', W(o.hour)], ['1일 통상임금', W(o.day)], ['월 기준시간', N(o.monthH, '시간')]], r: [['최저임금 대비(시간급)', o.hour >= MIN_WAGE ? '충족' : `부족 (2026년 ${W(MIN_WAGE)})`]],
          n: '근거: 근로기준법 시행령 제6조 — 월급은 월 기준시간[(1주 소정근로시간 + 유급 주휴시간) × 365/7 ÷ 12, 주 40시간이면 209시간]으로 나누고, 일급은 시간급 × 1일 소정근로시간. 대법원 2024.12.19. 2023다302838 전원합의체 판결로 재직·근무일수 조건이 붙은 정기상여금도 정기·일률적이면 통상임금에 들어갑니다(선고일 이후 산정분부터). 연장근로수당·실적 성과급처럼 소정근로 대가가 아닌 것은 넣지 않습니다. 최저임금 비교용 시급과는 산입 범위가 다를 수 있습니다.' }; }],
    ['인건비', 'pay', '급여·4대보험 계산기', '직원별 실수령액과 사업주 부담', null, null, 'cPay'],
    ['인건비', 'severance', '퇴직금 계산기', '평균임금·퇴직금과 퇴직소득세', [['start', '입사일', '', 'date'], ['end', '마지막 근무일', '', 'date'], ['hours', '1주 소정근로시간', 40, '시간'], ['wage3', '퇴직 전 3개월 임금 총액(세전)', 9000000, '원'], ['bonus', '1년간 정기상여금', 0, '원'], ['leavePay', '1년간 받은 연차수당', 0, '원'], ['base', '월 기본급(통상임금 비교용, 시급제는 0)', 2500000, '원'], ['fixed', '매월 고정수당(직책·자격·식대 등 모두에게 정기 지급)', 0, '원'], ['hourly', '시급제면 시급(월급제는 0)', 0, '원'], ['dayH', '1일 소정근로시간', 8, '시간']],
      v => { const r = severance(v);
        if (r.error) return { k: [['확인', r.error]], r: [], n: '' };
        if (!r.ok) return { k: [['퇴직금', '지급 대상 아님'], ['계속근로', N(r.days, '일')]], r: [['사유', r.why]], n: '' };
        return { k: [['퇴직금(세전)', W(r.pay)], ['퇴직소득세+지방세', W(r.tx.tax + r.tx.local)], ['실지급액', W(r.pay - r.tx.tax - r.tx.local)]],
          r: [['계속근로기간', N(r.days, '일')], ['평균임금(1일, 3개월 기준)', W(r.avg0)], ['1일 통상임금', W(ordinary({ ...v, week: v.hours }).day)], ['퇴직금에 쓴 1일 임금', W(r.avg) + (r.avg > r.avg0 ? ' (통상임금이 더 커서 통상임금 적용)' : ' (평균임금)')], ['3개월 기간 일수', N(r.p3, '일')], ['근속연수(세법)', N(r.years, '년')], ['근속연수공제', W(r.tx.yc)], ['환산급여', W(r.tx.conv)], ['환산급여공제', W(r.tx.cd)], ['과세표준', W(r.tx.base)], ['퇴직소득세 / 지방소득세', `${W(r.tx.tax)} / ${W(r.tx.local)}`]],
          n: '근거: 근로자퇴직급여 보장법 제4조①(1년 미만·주 15시간 미만 제외)·제8조①(1년에 30일분 평균임금)·제9조(퇴직 후 14일 이내 지급, 원칙적으로 근로자 IRP 계좌로 이전), 근로기준법 제2조①6·②(평균임금, 통상임금보다 적으면 통상임금)·시행령 제6조(통상임금), 소득세법 제48조·제55조②(퇴직소득세). 퇴직금 = 평균임금 × 30일 × 재직일수 ÷ 365. 상여금·연차수당은 3/12만 넣는 고용노동부 행정해석 방식입니다. 퇴직연금(DB·DC) 가입 회사는 적립 방식에 따라 다릅니다.' }; }],
    ['인건비', 'overtime', '연장·야간·휴일수당 계산기', '5인 이상 가산수당과 총액', [['wage', '통상임금 시급(모르면 통상임금 계산기)', MIN_WAGE, '원'], ['size', '사업장 규모(상시 근로자)', ['5명 이상', '4명 이하']], ['ext', '연장근로 시간(1일 8시간·1주 40시간 초과)', 10, '시간'], ['night', '야간근로 시간(22시~06시, 위 시간과 겹쳐도 따로)', 0, '시간'], ['hol8', '휴일근로 8시간 이내', 0, '시간'], ['holOver', '휴일근로 8시간 초과분', 0, '시간']],
      v => { const r = overtime({ ...v, five: v.size === '5명 이상' });
        return { k: [['지급할 총액', W(r.total)], ['가산수당', W(r.add)], ['일한 시간 임금', W(r.base)]], r: r.rows.map(([l, x]) => [l, W(x)]),
          n: v.size === '5명 이상' ? '근거: 근로기준법 제56조 — 연장 50%, 휴일 8시간 이내 50%·초과 100%, 야간(오후 10시~오전 6시) 50% 이상 가산. 야간은 다른 시간에 이미 들어간 시간이라 가산분만 더합니다(연장이면서 야간이면 50%+50%).'
            : '상시 4명 이하 사업장은 제56조(가산수당)가 적용되지 않습니다(근로기준법 시행령 별표 1). 일한 시간만큼의 임금은 그대로 지급해야 합니다.' }; }],
    ['인건비', 'inscheck', '알바·단시간 4대보험 판정', '어떤 보험에 가입하나 + 금액', [['type', '근로 형태', ['상용(알바·단시간 포함)', '일용']], ['week', '1주 소정근로시간', 20, '시간'], ['month', '1개월 소정근로시간(모르면 0 → 주 시간으로 환산)', 0, '시간'], ['months', '계속 근로 기간(예정 포함)', 3, '개월'], ['days', '일용: 1개월 근로일수', 0, '일'], ['age', '나이', 30, '세'], ['pay', '월 보수(비과세 제외)', 900000, '원']],
      v => { const r = insCheck({ ...v, type: v.type === '일용' ? '일용' : '상용' });
        return { k: [['근로자 부담 / 월', W(r.worker)], ['사업주 부담 / 월', W(r.employer)], ['월 소정근로시간', N(r.mh, '시간')]],
          r: r.rows.map(x => [`${x.n} ${x.on ? '✔ 가입' : '✕ 제외'}`, x.on ? `${W(x.w)} / ${W(x.e)} · ${x.why}` : x.why]),
          n: '금액은 근로자 / 사업주 순서입니다. 근거: 국민연금법 제8조①·시행령 제2조, 국민건강보험법 제6조②·시행령 제9조, 고용보험법 제10조·시행령 제3조, 산재보험은 모든 근로자 적용(업종 요율이라 금액 0으로 표시 — 근로복지공단 고지 요율 확인). ' + (r.old ? '65세 이후 새로 고용돼 고용보험 실업급여분(각 0.9%)은 빠지고 사업주 고용안정분만 냅니다. ' : '') + '일용 국민연금의 소득 기준(보건복지부 고시액)과 건강보험 공단 운영 기준은 반영하지 않았습니다.' }; }],
    ['인건비', 'annual', '연차·연차수당 계산기', '발생 연차와 미사용 수당', [['start', '입사일', '', 'date'], ['base', '기준일(오늘·퇴사일 등)', new Date().toISOString().slice(0, 10), 'date'], ['size', '사업장 규모(상시 근로자)', ['5명 이상', '4명 이하']], ['week', '1주 소정근로시간', 40, '시간'], ['used', '올해 사용한 연차', 0, '일'], ['base', '월 기본급(시급제는 0)', 2156880, '원'], ['fixed', '매월 고정수당(직책·자격·식대 등 모두에게 정기 지급)', 0, '원'], ['bonus', '1년간 정기상여금', 0, '원'], ['hourly', '시급제면 시급(월급제는 0)', 0, '원'], ['dayH', '1일 소정근로시간', 8, '시간']],
      v => { const r = annualLeave({ ...v, five: v.size === '5명 이상' });
        if (r.error) return { k: [['확인', r.error]], r: [], n: '' };
        if (r.why) return { k: [['발생 연차', '0일']], r: [['사유', r.why]], n: '' };
        const left = Math.max(0, r.days - v.used), part = v.week < 40, o = ordinary(v), leftH = left * 8 * Math.min(1, v.week / 40);
        return { k: [['발생 연차', N(r.days, '일') + (part ? ` (${N(r.hours, '시간')})` : '')], ['미사용', part ? `${N(left, '일')} (${N(leftH, '시간')})` : N(left, '일')], ['미사용 연차수당', W(leftH * o.hour)]],
          r: [['근속', `${r.years}년 (${r.months}개월)`], ['계산 방식', r.years < 1 ? '1년 미만: 1개월 개근마다 1일(최대 11일)' : '1년 이상: 15일 + 최초 1년 넘는 2년마다 1일(최대 25일)'], ['통상임금 시간급', W(o.hour) + ` (월 기준 ${o.monthH}시간)`], ['통상임금 1일분(8시간 기준)', W(o.hour * 8)]],
          n: '근거: 근로기준법 제60조(연차유급휴가), 제18조③(주 15시간 미만 제외), 시행령 별표 1(4명 이하 미적용), 단시간근로자는 통상근로자 시간에 비례(시행령 별표 2 — 시간 단위). 연차수당 = 미사용 시간 × 통상임금 시간급(제60조⑤·시행령 제6조). 1년간 80% 이상 출근·매월 개근했다고 보고 계산했습니다. 회계연도 기준으로 주는 회사는 결과가 다를 수 있습니다.' }; }],
    ['인건비', 'laborratio', '인건비 비율 계산기', '매출 대비 인건비 진단', [['sales', '월 매출', 30000000, '원'], ['labor', '월 인건비(사장님 부담 4대보험 포함)', 8000000, '원'], ['staff', '직원 수(사장님 제외)', 3, '명']],
      v => ({ k: [['인건비 비율', P(v.labor / v.sales * 100)], ['직원 1명당 매출', W(v.sales / Math.max(1, v.staff))], ['1명당 인건비', W(v.labor / Math.max(1, v.staff))]], r: [], n: '업종·운영 방식마다 적정 비율이 달라 기준선은 표시하지 않습니다. 매달 같은 방식으로 재서 추이를 보세요.' })],
    ['서류', 'payslip', '급여명세서 만들기', '임금명세서 바로 교부', [['biz', '사업장명', '', 'text'], ['name', '직원 이름', '', 'text'], ['month', '귀속 월', `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월`, 'text'], ['payday', '지급일', '', 'date'], ['base', '기본급', 2156880, '원'], ['ot', '연장·야간·휴일수당', 0, '원'], ['meal', '식대(비과세, 월 20만원까지)', 200000, '원'], ['fam', '공제대상 가족(본인 포함)', 1, '명']],
      v => { const taxable = v.base + v.ot + Math.max(0, v.meal - 2e5), ins = T.insurance(taxable), w = T.withholding(taxable, Math.max(1, v.fam), 0);
        return { k: [['실지급액', W(v.base + v.ot + v.meal - ins.worker - w.tax - w.local)], ['공제 합계', W(ins.worker + w.tax + w.local)], ['지급 합계', W(v.base + v.ot + v.meal)]], r: [], doc: PAYSLIP(v, ins, w),
          n: '근로기준법 제48조②: 임금을 줄 때 임금 구성항목·계산방법·공제내역을 적은 임금명세서를 서면(전자 포함)으로 주어야 합니다. \'인쇄\'로 PDF 저장도 됩니다. 식대 비과세 한도 월 20만원(소득세법 시행령 제17조의2).' }; }],
    ['서류', 'contract', '근로계약서 만들기', '알바·직원 근로계약서 채우기', [['type', '형태', ['단시간', '통상']], ['biz', '사업체명', '', 'text'], ['ceo', '대표자', '', 'text'], ['name', '근로자 이름', '', 'text'], ['start', '근로개시일', '', 'date'], ['end', '계약 종료일(정함 없으면 비움)', '', 'date'], ['place', '근무 장소', '', 'text'], ['job', '업무 내용', '', 'text'], ['time', '근무 시간', '10:00~15:00', 'text'], ['rest', '휴게시간', '12:00~12:30', 'text'], ['days', '근무일', '월~금', 'text'], ['off', '주휴일', '일요일', 'text'], ['payType', '임금 형태', ['시급', '월급']], ['wage', '임금', MIN_WAGE, '원'], ['payday', '임금 지급일(매월)', '10', 'text']],
      v => ({ k: [['임금', `${v.payType} ${W(v.wage)}`], ['최저임금', v.payType === '시급' ? (v.wage >= MIN_WAGE ? '충족' : '미달') : '월 환산 확인 필요'], ['근무', v.days]], r: [], doc: CONTRACT(v),
        n: '근로기준법 제17조: 임금·소정근로시간·휴일·연차유급휴가 등을 서면으로 명시하고 교부해야 합니다(단시간근로자는 근로일·근로일별 근로시간까지 — 기간제법 제17조). 고용노동부 표준근로계약서 양식을 바탕으로 줄였습니다.' })],
    ['운영', 'bep', '손익분기점 계산기', '얼마 팔아야 본전인지', [['fixed', '월 고정비(임대료·인건비 등)', 12000000, '원'], ['var', '변동비율(재료·수수료 등)', 40, '%'], ['ticket', '객단가', 15000, '원'], ['days', '월 영업일', 26, '일']],
      v => { const s = v.fixed / (1 - v.var / 100);
        return { k: [['손익분기 월 매출', W(s)], ['하루 매출', W(s / v.days)], ['하루 손님', N(Math.ceil(s / v.days / v.ticket), '명')]], r: [], n: '손익분기 매출 = 고정비 ÷ (1 − 변동비율). 사장님 생활비를 고정비에 넣으면 \'생활 가능한 매출\'이 됩니다.' }; }],
    ['운영', 'target', '매출 목표 계산기', '목표 순이익에 필요한 매출', [['profit', '목표 월 순이익', 5000000, '원'], ['fixed', '월 고정비', 12000000, '원'], ['var', '변동비율', 40, '%'], ['days', '월 영업일', 26, '일']],
      v => { const s = (v.profit + v.fixed) / (1 - v.var / 100);
        return { k: [['필요 월 매출', W(s)], ['하루 매출', W(s / v.days)], ['손익분기 대비', P(s / (v.fixed / (1 - v.var / 100)) * 100)]], r: [], n: '세전 이익 기준입니다. 종합소득세는 \'예상 세금\' 탭에서 확인하세요.' }; }],
    ['운영', 'fixed', '월 고정비 계산기', '고정비 합산과 항목별 비중', [['rent', '임대료', 2500000, '원'], ['mng', '관리비', 300000, '원'], ['labor', '인건비(4대보험 포함)', 6000000, '원'], ['util', '전기·가스·수도·통신', 600000, '원'], ['ins', '보험·렌탈·리스', 300000, '원'], ['int', '대출이자', 400000, '원'], ['etc', '기타(구독·세무 등)', 200000, '원']],
      (v, F) => { const items = F.map(f => [f[1], v[f[0]]]), s = items.reduce((a, b) => a + b[1], 0);
        return { k: [['월 고정비', W(s)], ['연간', W(s * 12)], ['가장 큰 항목', items.slice().sort((a, b) => b[1] - a[1])[0][0]]], r: items.map(([l, x]) => [l, `${W(x)} (${P(s ? x / s * 100 : 0)})`]), n: '' }; }],
    ['운영', 'turn', '재고 회전율 계산기', '재고 회전일과 회전수', [['b', '기초 재고', 8000000, '원'], ['e', '기말 재고', 6000000, '원'], ['cogs', '기간 매출원가(쓴 재료비)', 30000000, '원'], ['days', '기간 일수', 30, '일']],
      v => { const avg = (v.b + v.e) / 2, t = v.cogs / avg;
        return { k: [['회전수', N(t, '회')], ['회전일수', N(v.days / t, '일')], ['평균 재고', W(avg)]], r: [['연 환산 회전수', N(t * 365 / v.days, '회')]], n: '회전일수가 길수록 돈이 재고에 묶여 있다는 뜻입니다. 식재료는 유통기한과 같이 보세요.' }; }],
    ['운영', 'card', '카드 수수료 계산기', '구간별 수수료와 실입금액', [['tier', '연 카드매출 구간', Object.keys(CARD)], ['sales', '월 카드매출(부가세 포함)', 20000000, '원'], ['check', '그중 체크카드 비중', 30, '%']],
      v => { const [cr, ch] = CARD[v.tier], fee = v.sales * ((1 - v.check / 100) * cr + v.check / 100 * ch) / 100, cred = Math.min(v.sales * .013, 1e7 / 12);
        return { k: [['월 카드 수수료', W(fee)], ['실입금액', W(v.sales - fee)], ['부가세 카드공제(개인)', W(cred)]], r: [['적용 수수료율 (신용 / 체크)', `${cr}% / ${ch}%`], ['연 수수료', W(fee * 12)]],
          n: '우대수수료율: 금융위원회 2025.2.14 적용분(영세·중소가맹점, 연매출 30억 이하). 30억 초과는 카드사와 개별 계약. 신용카드매출전표 등 발행세액공제 1.3%(연 1천만원 한도)는 직전 연도 공급가액 10억 이하 개인사업자만 — 부가가치세법 제46조, 2026년까지.' }; }],
    ['부동산', 'rentratio', '임대료 비율 계산기', '매출 대비 임대료 진단', [['sales', '월 매출', 30000000, '원'], ['rent', '월세', 2500000, '원'], ['mng', '관리비', 300000, '원']],
      v => ({ k: [['임대료 비율(관리비 포함)', P((v.rent + v.mng) / v.sales * 100)], ['월세만', P(v.rent / v.sales * 100)], ['연 임대비용', W((v.rent + v.mng) * 12)]], r: [], n: '' })],
    ['부동산', 'pyeong', '평당 임대료 계산기', '평당·㎡당 단가와 면적 환산', [['rent', '월세', 2500000, '원'], ['area', '전용면적', 66, '㎡'], ['dep', '보증금', 30000000, '원']],
      v => { const py = v.area / 3.305785;
        return { k: [['평당 월세', W(v.rent / py)], ['㎡당 월세', W(v.rent / v.area)], ['면적', `${N(py, '평')} (${N(v.area, '㎡')})`]], r: [['평당 보증금', W(v.dep / py)]], n: '1평 = 3.305785㎡. 상가 광고의 \'평수\'는 공용면적을 넣은 계약면적일 때가 많으니 건축물대장의 전용면적과 비교하세요.' }; }],
    ['부동산', 'fairrent', '적정 임대료 계산기', '감당 가능한 최대 임대료', [['sales', '예상 월 매출', 30000000, '원'], ['ratio', '목표 임대료 비율', 10, '%'], ['mng', '관리비', 300000, '원']],
      v => { const max = v.sales * v.ratio / 100 - v.mng;
        return { k: [['감당 가능한 월세', W(Math.max(0, max))], ['관리비 포함 한도', W(v.sales * v.ratio / 100)], ['연간', W(Math.max(0, max) * 12)]], r: [], n: '목표 비율은 사장님이 정하는 값입니다. 매출이 불확실하면 보수적으로 잡으세요.' }; }],
    ['세금', 'wht', '원천세 계산기', '프리랜서 3.3%·일용직 원천징수', [['kind', '소득 종류', ['사업소득 3.3%', '기타소득 8.8% (필요경비 60%)', '기타소득 22% (필요경비 없음)', '일용근로소득']], ['amt', '지급액 (일용직은 일당)', 1000000, '원'], ['days', '일용직 근무일수', 1, '일']],
      v => { const days = v.kind === '일용근로소득' ? Math.max(1, v.days) : 1, gross = v.amt * days, w = wht(v.kind, v.amt, days);
        return { k: [['떼는 세금 합계', W(w.tax + w.local)], ['실지급액', W(gross - w.tax - w.local)], ['소득세 / 지방소득세', `${W(w.tax)} / ${W(w.local)}`]], r: w.note ? [['참고', w.note]] : [],
          n: '근거: 소득세법 제129조(사업소득 3%·기타소득 20%·일용 6%), 제47조②(일용 일 15만원 공제), 제59조③(일용 세액공제 55%), 제84조(기타소득금액 5만원 이하 과세최저한), 제86조(1천원 미만 소액부징수), 지방소득세 10%. 필요경비 60%는 강연료·원고료 등 시행령 제87조 대상만. 다음 달 10일까지 신고·납부, 지급명세서 제출.' }; }],
    ['세금', 'vat', '부가세 계산기', '공급가액·부가세·합계 변환', [['amt', '금액', 1100000, '원'], ['dir', '입력한 금액이', ['합계(부가세 포함)', '공급가액(부가세 별도)']]],
      v => { const sup = v.dir === '합계(부가세 포함)' ? Math.round(v.amt / 1.1) : v.amt, tax = v.dir === '합계(부가세 포함)' ? v.amt - sup : Math.floor(v.amt * .1);
        return { k: [['공급가액', W(sup)], ['부가세', W(tax)], ['합계', W(sup + tax)]], r: [], n: '부가가치세법 제30조: 세율 10%. 원 미만 처리는 거래처 관행에 따라 1원 차이가 날 수 있습니다.' }; }],
    ['세금', 'cg', '양도소득세 계산기', '부동산 팔 때 세금', null, null, 'cCg'],
    ['세금', 'gi', '상속·증여세 계산기', '물려주고 받을 때 세금', null, null, 'cGi'],
    ['기타', 'startup', '창업비용 계산기', '창업비용 합산과 예비비', [['dep', '보증금', 30000000, '원'], ['key', '권리금', 20000000, '원'], ['int', '인테리어', 40000000, '원'], ['eq', '주방·설비·집기', 25000000, '원'], ['first', '초도 물품·재료', 5000000, '원'], ['etc', '간판·홍보·인허가 등', 5000000, '원'], ['run', '운영자금(첫 몇 달 고정비)', 30000000, '원'], ['res', '예비비', 10, '%']],
      (v, F) => { const items = F.filter(f => f[0] !== 'res').map(f => [f[1], v[f[0]]]), s = items.reduce((a, b) => a + b[1], 0), r = s * v.res / 100;
        return { k: [['총 필요 자금', W(s + r)], ['예비비', W(r)], ['돌려받는 돈(보증금)', W(v.dep)]], r: items.map(([l, x]) => [l, W(x)]), n: '인테리어·설비는 세금계산서를 받으면 부가세를 조기환급 신청할 수 있습니다(부가가치세법 제59조). 사업자등록 전 매입은 주민번호로 세금계산서를 받아 두세요.' }; }],
    ['기타', 'runway', '창업 생존기간 계산기', '지금 현금으로 몇 개월 버틸까', [['cash', '지금 현금', 30000000, '원'], ['fixed', '월 고정비(생활비 포함)', 15000000, '원'], ['sales', '월 매출', 15000000, '원'], ['var', '변동비율', 40, '%']],
      v => { const burn = v.fixed - v.sales * (1 - v.var / 100);
        return { k: [['버틸 수 있는 기간', burn > 0 ? N(v.cash / burn, '개월') : '흑자 — 현금 안 줄어듦'], ['월 적자', W(Math.max(0, burn))], ['손익분기 매출', W(v.fixed / (1 - v.var / 100))]], r: [], n: '매출이 지금 수준에서 그대로라고 본 계산입니다. 부가세·종소세 납부 달에는 현금이 한 번에 빠집니다(\'세금 일정\' 탭).' }; }],
    ['기타', 'loan', '대출 이자 계산기', '월 상환액과 총 이자', [['p', '대출 원금', 50000000, '원'], ['rate', '연 이율', 5, '%'], ['n', '기간', 60, '개월'], ['kind', '상환 방식', ['원리금균등', '원금균등', '만기일시']]],
      v => { const x = loan(v.p, v.rate, Math.max(1, Math.round(v.n)), v.kind);
        return { k: [['첫 달 상환액', W(x.first)], ['총 이자', W(x.interest)], ['총 상환액', W(v.p + x.interest)]], r: [], n: '거치기간·중도상환수수료·변동금리는 넣지 않았습니다. 사업용 대출이자는 장부에 비용으로 넣을 수 있습니다.' }; }],
    ['기타', 'closing', '폐업비용 계산기', '폐업 정리 비용과 회수액', [['restore', '원상복구 공사', 10000000, '원'], ['penalty', '계약 위약금·남은 리스·렌탈', 3000000, '원'], ['sev', '직원 퇴직금·미지급 급여', 0, '원'], ['loss', '재고 처분 손실', 1000000, '원'], ['dep', '돌려받을 보증금', 30000000, '원'], ['key', '받을 권리금', 0, '원'], ['used', '중고 설비 매각', 3000000, '원']],
      v => { const cost = v.restore + v.penalty + v.sev + v.loss, back = v.dep + v.key + v.used;
        return { k: [['손에 남는 돈', W(back - cost)], ['정리 비용', W(cost)], ['회수액', W(back)]], r: [], n: '폐업해도 폐업일이 속한 달의 다음 달 25일까지 부가세 확정신고, 다음 해 5월 종합소득세 신고가 남습니다. 남은 재고·설비는 폐업 시 잔존재화로 부가세가 과세될 수 있습니다(부가가치세법 제10조⑥).' }; }],
  ];
  const all = list.map(([grp, id, title, sub, f, run, native]) => native ? { grp, id, title, sub, native } : { grp, id, title, sub, f, run: v => run(v, f) });   // native: index.html에 이미 있는 카드(여러 명 입력 등)
  return { all, MIN_WAGE, weekly, loan, wht, ordinary, severance, retireTax, overtime, insCheck, annualLeave };
})();
if (typeof module !== 'undefined') module.exports = Tools;
