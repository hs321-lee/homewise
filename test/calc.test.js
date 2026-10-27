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
