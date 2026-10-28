const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../site/calc.js");

const base = {
  price: 8, pubRatio: 69, salary: 8000, own: 2.5, smgRate: 3.5,
  bankType: "jugi", bankRate: 4.7, bankCap: 6, bankLtv: 70, dedOn: false,
  rentDeposit: 1, rentMonthly: 100, depRate: 2.5, oppOn: true, growth: 0, firstHome: true, m2Rate: 5.6,
  compRate: 1.5, compLegal: 4.6, compMax: 5, compLtv: 70, compGrace: 3, compYears: 10
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("소득세 구간", () => {
  assert.equal(H.incomeTax(1400), 84);
  near(H.incomeTax(5000), 624, 0.01, "5천만");
  near(H.incomeTax(8800), 1536, 0.01, "8,800만");
});

test("연봉 8,000만 과세표준은 24% 구간 초입", () => {
  const b = H.taxBase(8000, 0, 0);
  assert.ok(b > 5000 && b < 6000, String(b));
});

test("원리금균등 월 상환액", () => {
  near(H.annuity(50000, 1.5, 120), 448.95, 0.1, "5억 1.5% 10년");
  near(H.annuity(40000, 4, 360), 190.97, 0.1, "4억 4% 30년");
});

test("원리금균등 30년 4.7%는 비거치식 70% 요건(연 2.33%) 미달", () => {
  const fy = H.firstYear(10000, 4.7, 360);
  assert.ok(fy.p / 10000 < 0.7 / 30, String(fy.p));
});

test("8억 취득 비용 (생애최초 감면 포함)", () => {
  near(H.buyCosts(8, true).total, 2323.3, 1, "취득비용");
  near(H.buyCosts(8, false).total, 2523.3, 1, "감면 없음");
});

test("사내 대출: 한도·지원금 과세", () => {
  const r = H.simulate(base);
  assert.equal(r.C0, 50000);
  near(r.B.m[0].cInt, 62.5, 0.01, "월 이자");
  near(r.B.yTax[0].sup, 1550, 0.01, "지원금");
  near(r.B.yTax[0].supTax, 389, 3, "지원금 세금");
  near(r.compPay, 448.95, 0.1, "거치 후 원리금");
});

test("공시가 6억 초과면 은행 경로 공제 없음", () => {
  const r = H.simulate({ ...base, pubRatio: 80 });
  assert.equal(r.dedOK, false);
  assert.equal(r.C.yTax[0].dedRefund, 0);
});

test("공제 한도는 상품 유형을 따른다", () => {
  const rich = { ...base, salary: 15000 };
  const jugi = H.simulate(rich).C.yTax[0].ded;
  const mixed = H.simulate({ ...rich, bankType: "mixed" }).C.yTax[0].ded;
  assert.equal(jugi, 1800);
  assert.equal(mixed, 800);
});

test("갈아탄 대출 공제는 체크했을 때만", () => {
  assert.equal(H.simulate(base).B.yTax[3].ded, 0);
  assert.ok(H.simulate({ ...base, dedOn: true }).B.yTax[3].ded > 0);
});

test("은행 한도가 모자라면 직접 갚을 돈이 생긴다", () => {
  const r = H.simulate({ ...base, salary: 15000, bankCap: 4 });
  assert.equal(r.refiAmt, 40000);
  assert.equal(r.repay, 10000);
});

test("순자산: 시작은 자기자금 − 취득비용, 집값이 통화량만큼 오르면 더 큼", () => {
  const r = H.simulate(base);
  const flat = H.netWorth(base, r, r.B, 0), m2 = H.netWorth(base, r, r.B, 5.6);
  near(flat.buy[0], 25000 - r.costs, 0.01, "시작 순자산");
  assert.equal(flat.rent[0], 25000);
  assert.ok(m2.buy[10] > flat.buy[10]);
  assert.equal(flat.buy.length, 11);
});

test("통화량 기준선", () => {
  const l = H.moneyLine(10000, 5.6);
  near(l[10], 10000 * Math.pow(1.056, 10), 1e-6, "10년");
});

test("추천은 가능한 경로 중 하나", () => {
  const r = H.simulate(base);
  const rec = H.recommend(base, r);
  assert.ok(rec.best && ["A", "B", "C"].includes(rec.best.key));
});

test("은행 대출은 DSR 40%를 넘지 않는다", () => {
  const r = H.simulate(base);
  const d = H.dsr(base, r);
  assert.ok(d.C <= 40.01, String(d.C));
  assert.ok(d.B <= 40.01, String(d.B));
  assert.ok(r.bankMax <= r.bankLimit);
});

test("스트레스 금리: 주기형은 30%만 반영해 DSR 한도를 줄인다", () => {
  const v = { ...base, bankRate: 5, stress: 3 };
  near(H.dsrFactor(v), H.annuity(1, 5.9, 360) * 12, 1e-12, "주기형 5% + 3% × 30%");
  near(H.dsrFactor({ ...v, bankType: "mixed" }), H.annuity(1, 6.8, 360) * 12, 1e-12, "혼합형 60%");
  assert.ok(H.maxPriceBank(v) < H.maxPriceBank({ ...v, stress: 0 }));
  assert.ok(H.simulate(v).bankMax < H.simulate({ ...v, stress: 0 }).bankMax);
});

test("스트레스 금리는 실제 상환액에는 쓰지 않는다", () => {
  const v = { ...base, salary: 15000, bankRate: 5 };
  const a = H.simulate({ ...v, stress: 0 }), b = H.simulate({ ...v, stress: 3 });
  assert.equal(a.bankMax, b.bankMax); // 고소득이면 한도(6억)에 먼저 걸려 같은 금액
  near(a.C.m[0].bInt, b.C.m[0].bInt, 1e-9, "같은 대출이면 같은 이자");
});

test("보수적 최고가: 매달 나가는 돈 + 갈아탈 때 갚을 돈 모으기가 세후 월소득 50% 이하", () => {
  const v = { ...base, salary: 5300, own: 1, bankRate: 5, stress: 3, depRate: 3 };
  const P = H.maxPriceSafe(v, 50);
  const r = H.simulate({ ...v, price: P });
  const span = Math.max(r.G, 12);
  const need = H.avg(r.B.m, 0, span, o => o.cash) + r.repay / span;
  assert.ok(need <= H.netMonthly(v.salary) * 0.5 + 0.01, String(need));
  assert.ok(P > 3.5 && P < 4.5, String(P)); // 신입 5,300만 · 1억이면 약 4억
  assert.ok(H.maxPriceSafe(v, 40) < P, "기준이 낮으면 더 낮다");
  assert.ok(H.maxPriceSafe({ ...v, salary: 8000 }, 50) > P, "연봉이 높으면 더 높다");
});

test("지금 살까, 기다릴까: 집값이 그대로면 월세 + 취득비용 − 지금 산 쪽 비용", () => {
  const r = H.simulate(base);
  const w = H.waitCost(base, r, r.B, 2, 0);
  near(w.cost, r.rentCum[24] + H.buyCosts(base.price, true).total - r.B.cumArr[24], 1e-6, "2년");
  assert.equal(w.up, 0);
  const up = H.waitCost(base, r, r.B, 2, 5.6);
  assert.ok(up.cost > w.cost, "집값이 오르면 기다린 비용이 더 크다");
  near(up.up, 80000 * (1.056 ** 2 - 1), 1e-6, "오른 집값");
});

test("연봉 상승률: 갈아탈 때 오른 연봉으로 은행 한도를 다시 계산", () => {
  const v = { ...base, own: 1, price: 6, bankRate: 5, stress: 3 };
  const flat = H.simulate({ ...v, raise: 0 }), up = H.simulate({ ...v, raise: 5 });
  near(up.refiSal, 8000 * 1.05 ** 3, 1e-6, "3년 뒤 연봉");
  assert.equal(flat.refiSal, 8000);
  assert.ok(up.refiAmt > flat.refiAmt && up.repay < flat.repay, "한도가 늘고 직접 갚을 돈이 준다");
  assert.ok(H.dsr({ ...v, raise: 5 }, up).B <= 40.01, "그때 연봉 기준 DSR 40% 이하");
  assert.ok(H.maxPriceSafe({ ...v, raise: 5 }) > H.maxPriceSafe({ ...v, raise: 0 }), "보수적 예산이 오른다");
  assert.equal(H.simulate({ ...v, raise: 5 }).bankMax, flat.bankMax, "처음 은행 한도는 지금 연봉 기준");
});

test("결혼: 혼인신고 후 부부 소득 합산이면 갈아탈 때 한도가 늘고 보수적 예산이 오른다", () => {
  const v = { ...base, own: 1, price: 6, bankRate: 5, stress: 3, raise: 0 };
  const single = H.simulate(v), wed = H.simulate({ ...v, refiExtra: 5000 });
  assert.equal(wed.refiSal, 13000);
  assert.ok(wed.refiAmt >= single.refiAmt && wed.repay <= single.repay);
  const both = { ...v, extraIncome: 5000 };
  assert.equal(H.dsrIncome(both), 13000);
  near(H.netHousehold(both), H.netMonthly(8000) + H.netMonthly(5000), 1e-9, "가구 세후 월소득");
  assert.ok(H.maxPriceSafe(both) > H.maxPriceSafe(v));
});

test("3년 뒤 집 갈아타기: 판 돈에서 대출을 갚고 모은 돈을 더해 새 집에 넣는다", () => {
  const v = { ...base, own: 1, price: 5, bankRate: 5, stress: 3, raise: 3, growth: 0,
    married: true, spSalary: 5000, spOwn: 0.5, save3: 0.5, price2: 7.5 };
  const m = H.moveUp(v), r = H.simulate(v);
  near(m.sale, 50000, 1e-6, "집값 그대로");
  near(m.equity, 50000 - 250 - r.C0 - r.fc.smg * 0.7, 1e-6, "남는 돈");
  near(m.cashIn, m.equity + 5000 + 5000, 1e-6, "모은 돈 합산");
  assert.equal(m.v2.firstHome, false);
  near(m.v2.extraIncome, 5000 * 1.03 ** 3, 1e-6, "배우자 연봉도 상승");
  assert.ok(m.safe > H.moveUp({ ...v, married: false }).safe, "결혼하면 예산이 커진다");
  assert.ok(m.stayIncome > H.moveUp({ ...v, married: false }).stayIncome, "그대로 살 때도 갈아탈 때 부부 합산");
  assert.equal(H.maxPriceSafe(v), H.maxPriceSafe({ ...v, married: false }), "지금 집 예산은 결혼과 무관");
  assert.ok(H.moveUp({ ...v, growth: 3 }).equity > m.equity, "집값이 오르면 남는 돈이 늘어난다");
});
