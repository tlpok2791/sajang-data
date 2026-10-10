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
console.log('tax_test OK');
