// node bizapp/tax_test.js — 세액 계산이 법정 세율표와 맞는지 확인
const T = require('./tax.js'), eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} !== ${b}`) };

eq(T.incomeTax(14e6), 84e4, '종소 1,400만 = 84만');
eq(T.incomeTax(50e6), 624e4, '종소 5,000만 = 624만');
eq(T.incomeTax(1e8), 1536e4 + 12e6 * .35, '종소 1억 = 1,536만 + 1,200만×35%');
eq(T.incomeTax(12e8), 38406e4 + 2e8 * .45, '종소 12억');
eq(T.incomeTax(-5), 0, '결손이면 0');
eq(T.corpTax(2e8), 2e7, '법인 2억 = 10%');
eq(T.corpTax(3e8), 2e7 + 1e8 * .2, '법인 3억 = 2천만 + 1억×20%');
eq(T.corpTax(3e8, true), 6e7, '소규모 임대법인 3억 = 20%');

// 일반과세 음식점(개인): 반기 매출 1억(카드 8천만), 과세매입 3천만, 면세 식재료 2천만
let v = T.vatGeneral({ sales: 1e8, card: 8e7, buyTax: 3e7, buyFree: 2e7 }, { kind: '개인', industry: '음식점업' });
eq(v.deemedRate, '9/109', '과표 2억 이하 개인 음식점 9/109');
eq(v.deemed, Math.floor(2e7 * 9 / 109), '의제매입');
eq(v.card, Math.floor(8.8e7 * .013), '카드 1.3% (부가세 포함 발행금액)');
eq(v.tax, 1e7 - 3e6 - v.deemed - v.card, '납부세액');
// 카드공제는 납부세액을 넘지 않고, 연 한도 잔액을 넘지 않는다
eq(T.vatGeneral({ sales: 1e7, card: 1e7, buyTax: 9.9e6, buyFree: 0 }, { kind: '개인', industry: '소매업' }).card, 1e4, '납부세액 한도 (매출세액 100만 - 매입세액 99만 = 1만)');
eq(T.vatGeneral({ sales: 1e9, card: 1e9, buyTax: 0, buyFree: 0 }, { kind: '개인', industry: '소매업', cardUsed: 9e6 }).card, 1e6, '연 1천만원 한도 잔액');
eq(T.vatGeneral({ sales: 1e8, card: 1e8, buyTax: 0, buyFree: 0 }, { kind: '법인', industry: '소매업' }).card, 0, '법인은 카드공제 없음');

// 간이: 음식점 공급가액 1억(공급대가 1.1억), 과세매입 공급가액 3천만
let s = T.vatSimple({ sales: 1e8, card: 0, buyTax: 3e7 }, { industry: '음식점업' });
eq(s.tax, Math.floor(1.1e8 * .15 * .1) - Math.floor(3.3e7 * .005), '간이 = 공급대가×15%×10% - 매입×0.5%');
eq(T.vatSimple({ sales: 4e7, card: 0, buyTax: 0 }, { industry: '음식점업' }).exempt, true, '공급대가 4,400만 < 4,800만 면제');

let i = T.income({ sales: 1.2e8, buyTax: 4e7, buyFree: 1e7, labor: 2e7, other: 1e7 }, { people: 2 });
eq(i.base, 4e7 - 3e6, '종소 과표 = 이익 - 기본공제 2인');
eq(i.local, Math.floor(i.tax * .1), '지방소득세 10%');
// 4대보험: 월 300만원, 150인 미만, 산재 1%
let n = T.insurance(3e6, { injury: .01 });
eq(n.rows[0][1], 142500, '국민연금 근로자 300만×4.75%');
eq(n.rows[1][1], 107850, '건강보험 300만×3.595%');
eq(n.rows[2][1], 14170, '장기요양 300만×0.4724% (10원 미만 절사)');
eq(n.rows[3][1], 27000, '고용 근로자 0.9%');
eq(n.rows[3][2], 34500, '고용 사업주 0.9%+0.25%');
eq(n.rows[4][2], 30000, '산재 사업주 1%');
eq(n.worker, 142500 + 107850 + 14170 + 27000, '근로자 합계');
eq(T.insurance(1e7).pensionBase, 659e4, '국민연금 상한 659만원');
eq(T.insurance(3e5).pensionBase, 41e4, '국민연금 하한 41만원');
eq(T.insurance(3e6, { size: 'ge1000' }).rows[3][2], 52500, '1천명 이상 사업주 0.9%+0.85% = 300만×1.75%');
// 근로소득 간이세액표 (2026 원문과 대조한 값)
eq(T.withholding(2005000, 1).tax, 19520, '월 200.5만 본인1명 = 19,520');
eq(T.withholding(2005000, 1).local, 1950, '지방소득세 10%');
eq(T.withholding(2985000, 10).tax, 3070, '월 298.5만 가족10명');
eq(T.withholding(700000, 1).tax, 0, '77만원 미만 0');
eq(T.withholding(2805000, 2, 1).tax, 39300 - 20830, '자녀 1명 20,830원 공제');
eq(T.withholding(2805000, 3, 3).tax, Math.max(0, 25180 - (45830 + 33330)), '자녀 3명, 음수면 0');
eq(T.withholding(1e7, 1).tax, 1507400, '1,000만원 정확히 = 10,000천원 행');
eq(T.withholding(12e6, 1).tax, Math.floor((1507400 + 2e6 * .98 * .35 + 25000) / 10) * 10, '1,200만원 = 1천만 세액 + 초과분×98%×35% + 2.5만');
// 양도소득세
let q = T.transferTax({ price: 10e8, cost: 6e8, years: 5, kind: 'house', oneHouse: true });
eq(q.tax, 0, '1세대1주택 12억 이하 비과세');
q = T.transferTax({ price: 5e8, cost: 3e8, expense: 1e7, years: 5, kind: 'building' });
eq(q.lt, Math.floor(1.9e8 * .10), '일반 5년 보유 장특 10%');
eq(q.base, 1.9e8 - 1.9e7 - 250e4, '과표 = 양도차익 - 장특 - 기본공제 250만');
eq(q.tax, T.incomeTax(q.base), '2년 이상 보유 = 기본세율');
eq(q.local, Math.floor(q.tax * .1), '지방소득세 10%');
q = T.transferTax({ price: 3e8, cost: 2e8, years: 0.5, kind: 'house' });
eq(q.tax, Math.floor((1e8 - 250e4) * .70), '주택 1년 미만 70%');
q = T.transferTax({ price: 3e8, cost: 2e8, years: 1.5, kind: 'land' });
eq(q.tax, Math.floor((1e8 - 250e4) * .40), '토지 1~2년 40%');
q = T.transferTax({ price: 20e8, cost: 10e8, years: 10, resYears: 10, kind: 'house', oneHouse: true });
eq(q.gain, Math.floor(10e8 * (20e8 - 12e8) / 20e8), '고가주택: 12억 초과분 비율만 과세');
eq(q.ltRate, .80, '1세대1주택 10년 보유·거주 장특 80%');
q = T.transferTax({ price: 5e8, cost: 3e8, years: 5, kind: 'house', heavy: 20 });
eq(q.lt, 0, '중과 주택은 장특 배제');
eq(q.tax, Math.floor(T.incomeTax(q.base) + q.base * .20), '조정 2주택 +20%p');
// 증여세
let g = T.giftTax({ amount: 1e8, relation: 'up' });
eq(g.base, 5e7, '성인 자녀 1억 증여 - 공제 5천만');
eq(g.calc, 5e6, '과표 5천만 × 10%');
eq(g.tax, 5e6 - 150000, '신고세액공제 3%');
eq(T.giftTax({ amount: 1.5e8, relation: 'up', marriage: true }).tax, 0, '혼인 공제 1억 + 5천만 = 1.5억 → 0');
eq(T.giftTax({ amount: 7e8, relation: 'spouse' }).calc, 1e7, '배우자 7억 - 6억 = 1억 × 10%');
g = T.giftTax({ amount: 1e8, relation: 'up', skipGen: true });
eq(g.surcharge, 1.5e6, '손주 증여 할증 30%');
eq(T.giftTax({ amount: 2e8, relation: 'up' }).calc, 1e7 + 5e7 * .20, '과표 1.5억 = 1천만 + 5천만×20%');
// 상속세
let h = T.inheritTax({ estate: 10e8, funeral: 5e6, kids: 2 });
eq(h.personal, 5e8, '일괄공제 5억 (기초2억+자녀2명 1억보다 큼)');
eq(h.base, 10e8 - 5e6 - 5e8, '배우자 없음: 과세가액 - 일괄공제');
eq(h.calc, 1e7 + (h.base - 1e8) * .20, '과표 4.95억 = 1천만 + 1억 초과분×20%');
eq(T.inheritTax({ estate: 9e8, spouse: true, kids: 2 }).tax, 0, '배우자+자녀: 일괄 5억 + 배우자 5억 → 0');
eq(T.inheritTax({ estate: 20e8, finNet: 5e8, kids: 1 }).fin, 1e8, '금융재산 5억 × 20% = 1억');
// 주민세 사업소분
eq(T.residentBiz({ kind: '개인' }).total, 5e4, '개인 사업소분 5만원');
eq(T.residentBiz({ kind: '법인', capital: 40e8 }).total, 1e5, '자본금 30억 초과 50억 이하 10만원');
eq(T.residentBiz({ kind: '개인', area: 400 }).total, 5e4 + 400 * 250, '연면적 330㎡ 초과: ㎡당 250원');
// 사업자등록번호 검증 (삼성전자 124-81-00998 — 국세청 상태조회로 실재 확인한 번호)
eq(T.bizNoValid('124-81-00998'), true, '실제 사업자번호 검증 통과');
eq(T.bizNoValid('124-81-00997'), false, '끝자리 틀리면 실패');
eq(T.bizNoValid('12345'), false, '자릿수 부족');
// 사장님 계산기 (tools.js) — 법령 숫자로 손계산한 기대값
const L = require('./tools.js'), run = (id, v) => L.all.find(t => t.id === id).run(v);
eq(L.weekly(10320, 20), 41280, '주휴: 주 20시간 → 20/40×8시간×10,320');
eq(L.weekly(10320, 14), 0, '주 15시간 미만 주휴 없음 (근기법 시행령 제30조)');
eq(L.weekly(10000, 45), 80000, '주휴는 8시간 상한');
eq(L.wht('사업소득 3.3%', 1e6).tax + L.wht('사업소득 3.3%', 1e6).local, 33000, '사업소득 100만 → 3만 + 3천');
eq(L.wht('기타소득 8.8% (필요경비 60%)', 1e6).tax, 80000, '기타소득 100만 × 40% × 20%');
eq(L.wht('기타소득 8.8% (필요경비 60%)', 125000).tax, 0, '기타소득금액 5만원 이하 과세최저한 (제84조)');
eq(L.wht('일용근로소득', 2e5).tax, 1350, '일용 20만: (20만-15만)×6%×45% = 1,350');
eq(L.wht('일용근로소득', 2e5).local, 130, '지방소득세 135 → 10원 미만 절사');
eq(L.wht('일용근로소득', 16e4).tax, 0, '일용 16만: 270원 < 1천원 소액부징수 (제86조)');
eq(Math.round(L.loan(12e6, 0, 12, '원리금균등').first), 1e6, '무이자 원리금균등 = 원금/12');
eq(Math.round(L.loan(1e7, 12, 12, '만기일시').interest), 12e5, '만기일시 1천만 연12% 1년 이자 120만');
eq(Math.round(L.loan(12e5, 12, 12, '원금균등').interest), 78000, '원금균등 120만 연12%: (120만+110만+…+10만)×1%');
eq(run('vat', { amt: 1100000, dir: '합계(부가세 포함)' }).k[0][1], '1,000,000원', '합계 110만 → 공급가 100만');
eq(run('card', { tier: '3억~5억', sales: 1e7, check: 0 }).k[0][1], '100,000원', '3~5억 신용 1.00% (금융위 2025.2.14)');
eq(run('card', { tier: '3억~5억', sales: 1e7, check: 100 }).k[0][1], '75,000원', '3~5억 체크 0.75%');
console.log('tax_test OK');
