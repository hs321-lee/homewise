/* Homewise 계산 로직. 단위는 만원, 집값·한도 입력은 억. 브라우저(window.Homewise)와 Node(require) 둘 다 지원 */
(function (root) {
  "use strict";

  const N = 120; // 비교 기간 10년(월)
  const LIMIT = { jugi: 1800, jugiEq: 2000, mixed: 800 }; // 장기주택저당차입금 이자 소득공제 한도(15년 이상)
  const SMG_MAX = 30000; // 보증보험구입대출 최대 3억
  const DSR_MAX = 40;    // 은행 DSR 한도(%)

  /* 표시 */
  function won(v) {
    const neg = v < 0;
    v = Math.round(Math.abs(v));
    let s;
    if (v >= 10000) {
      const e = Math.floor(v / 10000), r = v % 10000;
      s = e + "억" + (r ? " " + r.toLocaleString("ko-KR") + "만" : "");
    } else s = v.toLocaleString("ko-KR") + "만";
    return (neg ? "−" : "") + s;
  }
  const eok = v => (Math.round(v * 100) / 100).toString().replace(/\.?0+$/, "") + "억";
  const pct = (v, d = 2) => v.toFixed(d) + "%";

  /* 근로소득세 (지방소득세 10% 포함) */
  function earnDed(g) {
    if (g <= 500) return g * .7;
    if (g <= 1500) return 350 + (g - 500) * .4;
    if (g <= 4500) return 750 + (g - 1500) * .15;
    if (g <= 10000) return 1200 + (g - 4500) * .05;
    return Math.min(2000, 1475 + (g - 10000) * .02);
  }
  const insurance = s => Math.min(s, 659 * 12) * .0475 + s * .03595 * 1.1314 + s * .009;
  const BRACKETS = [[1400, .06, 0], [5000, .15, 126], [8800, .24, 576], [15000, .35, 1544],
    [30000, .38, 1994], [50000, .40, 2594], [100000, .42, 3594], [Infinity, .45, 6594]];
  function incomeTax(base) {
    for (const [lim, r, d] of BRACKETS) if (base <= lim) return Math.max(0, base * r - d);
  }
  /* 과세표준 추정: 본인 기본공제 150만, 4대보험, 기타 공제 250만 */
  function taxBase(sal, extra, ded) {
    const g = sal + extra;
    return Math.max(0, g - earnDed(g) - 150 - insurance(sal) - 250 - ded);
  }
  const tax = (sal, extra, ded) => incomeTax(taxBase(sal, extra, ded)) * 1.1;
  const refund = (sal, ded) => tax(sal, 0, 0) - tax(sal, 0, ded);

  /* 취득 비용: 취득세·지방교육세(85㎡ 이하), 중개수수료, 등기비 150만(추정) */
  function buyCosts(P, firstHome) {
    const v = P * 10000;
    const rate = P <= 6 ? 1 : P <= 9 ? (P * 2 / 3 - 3) : 3;
    let acq = v * rate / 100;
    const edu = P <= 6 ? v * .001 : P <= 9 ? acq * .1 : v * .003;
    if (firstHome && P <= 12) acq = Math.max(0, acq - 200);
    const fee = v * (P < 9 ? .004 : P < 12 ? .005 : P < 15 ? .006 : .007);
    return { acq, edu, fee, reg: 150, total: acq + edu + fee + 150 };
  }

  function annuity(pv, rYear, n) {
    const r = rYear / 1200;
    return r === 0 ? pv / n : pv * r / (1 - Math.pow(1 + r, -n));
  }
  /* 원리금균등 첫 12개월 이자·원금 합 */
  function firstYear(pv, rate, n) {
    const pay = annuity(pv, rate, n);
    let b = pv, i = 0, p = 0;
    for (let k = 0; k < 12; k++) { const ii = b * rate / 1200; i += ii; p += pay - ii; b -= pay - ii; }
    return { i, p };
  }

  /* 모자란 돈은 보증보험구입대출로 채움 */
  function funding(P, costs, loan, own, smgCap = SMG_MAX) {
    const need = P * 10000 + costs - loan;
    const smg = Math.max(0, Math.min(smgCap, need - own * 10000));
    const ownUsed = need - smg;
    return { need, smg, ownUsed, shortfall: Math.max(0, ownUsed - own * 10000) };
  }

  /*
   * 경로
   *  A: 사내대출 → 거치 끝나면 그대로 원리금균등 상환
   *  B: 사내대출 → 거치 끝나면 은행 주담대로 갈아타기
   *  C: 처음부터 은행 주담대
   */
  /* DSR 계산용 은행 원리금 계수(1만원당 연 원리금). 수도권 주담대는 금리에 스트레스 금리를 더해 한도를 계산합니다.
     반영 비율: 5년 주기형 30%, 혼합형 60% (3단계 스트레스 DSR). 실제 상환액 계산에는 쓰지 않습니다 */
  const STRESS_SHARE = { jugi: .3, jugiEq: .3, mixed: .6 };
  function dsrFactor(v) {
    const r = v.bankRate + (v.stress || 0) * STRESS_SHARE[v.bankType];
    return v.bankType === "jugiEq" ? 1 / 30 + r / 100 : annuity(1, r, 360) * 12;
  }

  function simulate(v) {
    const P = v.price, pub = P * v.pubRatio / 100, dedOK = pub <= 6;
    const limit = LIMIT[v.bankType], eqPrin = v.bankType === "jugiEq";
    const costs = buyCosts(P, v.firstHome).total;
    const bankLimit = Math.min(v.bankCap * 10000, P * 10000 * v.bankLtv / 100);
    const C0 = Math.min(v.compMax * 10000, P * 10000 * v.compLtv / 100);
    /* DSR: (은행 원리금 + 보증보험구입대출 원리금) / 연봉 ≤ 40% */
    const smgYear = S => S > 0 ? S / 10 + S * v.smgRate / 100 * .95 : 0;
    const bankFactor = dsrFactor(v);
    const dsrCap = smg => Math.max(0, (v.salary * DSR_MAX / 100 - smgYear(smg)) / bankFactor);
    const support = Math.max(0, v.compLegal - v.compRate); // 소득으로 잡히는 회사 지원 금리
    const G = Math.round(v.compGrace * 12), compN = Math.round(v.compYears * 12);
    const fc = funding(P, costs, C0, v.own);
    /* 보증보험구입대출(10년 상환)이 DSR을 더 많이 차지하므로 은행 대출을 먼저 채우고, 남은 DSR 안에서 보증보험구입대출을 씁니다 */
    const bankMax = Math.min(bankLimit, dsrCap(0));
    const smgFactor = 1 / 10 + v.smgRate / 100 * .95;
    const smgRoom = Math.max(0, (v.salary * DSR_MAX / 100 - bankMax * bankFactor) / smgFactor);
    const fb = funding(P, costs, bankMax, v.own, Math.min(SMG_MAX, smgRoom));
    const dsrBound = bankMax < bankLimit - 1 || smgRoom < SMG_MAX;
    const refiAmt = Math.min(C0, bankLimit, dsrCap(fc.smg)), repay = C0 - refiAmt;
    const propTax = pub * 10000 * .0013;
    const dr = v.oppOn ? v.depRate / 100 : 0;
    const compPay = annuity(C0, v.compRate, compN);
    const base0 = tax(v.salary, 0, 0);

    function run(mode) {
      const f = mode === "C" ? fb : fc;
      let c = mode === "C" ? 0 : C0, s = f.smg, b = 0, b0 = 0, bankPay = 0;
      const smgP = f.smg / 120;
      const startBank = amt => { b = b0 = amt; bankPay = eqPrin ? 0 : annuity(amt, v.bankRate, 360); };
      if (mode === "C") startBank(bankMax);
      const dedOn = dedOK && (mode === "C" || (mode === "B" && v.dedOn));
      const m = [], yr = Array.from({ length: N / 12 }, () => ({ sup: 0, bInt: 0 }));
      for (let i = 1; i <= N; i++) {
        const y = Math.floor((i - 1) / 12);
        let cInt = 0, cPr = 0, sInt = 0, sPr = 0, bInt = 0, bPr = 0;
        if (i === G + 1 && mode === "B") { c = 0; startBank(refiAmt); }
        if (c > 0) {
          cInt = c * v.compRate / 1200;
          yr[y].sup += c * support / 1200;
          if (i > G) cPr = Math.min(c, compPay - cInt);
          c -= cPr;
        }
        if (b > 0) {
          bInt = b * v.bankRate / 1200;
          bPr = Math.min(b, eqPrin ? b0 / 360 : bankPay - bInt);
          b -= bPr;
          yr[y].bInt += bInt;
        }
        if (s > 0) { sInt = s * v.smgRate / 1200; sPr = Math.min(s, smgP); s -= sPr; }
        const opp = (f.ownUsed + (mode === "B" && i > G ? repay : 0)) * dr / 12;
        const lump = mode === "B" && i === G + 1 ? repay : 0;
        m.push({ cInt, cPr, sInt, sPr, bInt, bPr, opp, lump, debt: c + s + b });
      }
      const yTax = yr.map(o => {
        const ded = dedOn ? Math.min(o.bInt, limit) : 0;
        const supTax = tax(v.salary, o.sup, 0) - base0;
        const net = tax(v.salary, o.sup, ded) - base0;
        return { sup: o.sup, supTax, ded, dedRefund: supTax - net, net, bInt: o.bInt };
      });
      let cum = costs;
      const cumArr = [cum];
      m.forEach((o, k) => {
        o.tax = yTax[Math.floor(k / 12)].net / 12;
        o.sunk = o.cInt + o.sInt + o.bInt + o.tax + propTax / 12 + o.opp;
        o.cash = o.cInt + o.cPr + o.sInt + o.sPr + o.bInt + o.bPr + o.tax + propTax / 12;
        cum += o.sunk;
        cumArr.push(cum);
      });
      return { m, yTax, cumArr, f };
    }

    const A = run("A"), B = run("B"), C = run("C");
    const rentM = v.rentMonthly + v.rentDeposit * 10000 * dr / 12;
    const rentCum = Array.from({ length: N + 1 }, (_, i) => rentM * i);
    return { P, pub, dedOK, limit, costs, C0, G, support, compPay, fc, fb, bankLimit, bankMax, dsrBound, refiAmt, repay, propTax, A, B, C, rentM, rentCum };
  }

  const avg = (arr, from, to, f) => { let s = 0; for (let i = from; i < to; i++) s += f(arr[i]); return s / (to - from); };

  /* 자금(자기자금 + 대출 + 보증보험구입대출 3억)으로 살 수 있는 최고가, 억 */
  function maxPrice(v, loanFn) {
    let lo = 1, hi = 25;
    for (let k = 0; k < 40; k++) {
      const P = (lo + hi) / 2;
      const need = P * 10000 + buyCosts(P, v.firstHome).total - loanFn(P);
      if (need - SMG_MAX <= v.own * 10000) lo = P; else hi = P;
    }
    return lo;
  }

  /* 은행 경로 최고가: LTV·한도·DSR 40%를 모두 지키면서 살 수 있는 가격, 억 */
  function maxPriceBank(v) {
    const bf = dsrFactor(v);
    const sf = 1 / 10 + v.smgRate / 100 * .95, cap = v.salary * DSR_MAX / 100;
    let lo = 1, hi = 25;
    for (let k = 0; k < 40; k++) {
      const P = (lo + hi) / 2;
      const L = Math.min(v.bankCap * 10000, P * 100 * v.bankLtv, cap / bf);
      const smg = Math.min(SMG_MAX, Math.max(0, (cap - L * bf) / sf));
      if (P * 10000 + buyCosts(P, v.firstHome).total - L - smg <= v.own * 10000) lo = P; else hi = P;
    }
    return lo;
  }

  /* 세후 월소득(만원): 연봉 − 4대보험 − 소득세(지방세 포함), 12로 나눔 */
  const netMonthly = sal => (sal - insurance(sal) - tax(sal, 0, 0)) / 12;

  /* 보수적 최고가(억): 사내 대출 경로로 살 때 처음 몇 년(거치 기간, 없으면 1년) 매달 통장에서 나가는 돈과
     거치가 끝나 은행으로 갈아탈 때 직접 갚아야 할 돈을 그 기간에 나눠 모으는 돈의 합이 세후 월소득의 share% 이하이고,
     자금이 모자라지 않는 가장 비싼 집값 */
  function maxPriceSafe(v, share = 50) {
    const cap = netMonthly(v.salary) * share / 100;
    const ok = P => {
      const r = simulate({ ...v, price: P });
      const span = Math.max(r.G, 12);
      return r.fc.shortfall === 0 && avg(r.B.m, 0, span, o => o.cash) + r.repay / span <= cap;
    };
    let lo = 1, hi = 25;
    if (!ok(lo)) return 0;
    for (let k = 0; k < 30; k++) { const P = (lo + hi) / 2; if (ok(P)) lo = P; else hi = P; }
    return lo;
  }

  /* 지금 살까, 기다릴까(만원): years년 기다렸다가 사면 지금 사는 것보다 얼마나 더 드는지.
     기다린 쪽 = 그동안 낸 월세(보증금 기회비용 포함) + 오른 집값 + 나중에 낼 취득비용
     지금 산 쪽 = 같은 기간 사라진 돈(취득비용·이자·세금 등, sim.cumArr)
     양수면 기다린 쪽이 손해. g는 연 집값 상승률(%) */
  function waitCost(v, r, sim, years, g) {
    const k = Math.round(years * 12);
    const later = v.price * Math.pow(1 + g / 100, years);
    const rent = r.rentCum[k], up = (later - v.price) * 10000, costs = buyCosts(later, v.firstHome).total;
    return { rent, up, costs, buy: sim.cumArr[k], cost: rent + up + costs - sim.cumArr[k], later };
  }

  /* 연간 원리금 / 연봉 (DSR, 은행 대출은 스트레스 금리 반영) */
  function dsr(v, r) {
    const smgYear = S => S > 0 ? S / 10 + S * v.smgRate / 100 * .95 : 0;
    const bankYear = amt => amt * dsrFactor(v);
    return {
      A: (r.compPay * 12 + smgYear(r.fc.smg)) / v.salary * 100,
      B: (bankYear(r.refiAmt) + smgYear(r.fc.smg)) / v.salary * 100,
      C: (bankYear(r.bankMax) + smgYear(r.fb.smg)) / v.salary * 100
    };
  }

  /* 갈 수 있는 경로 중 10년 누적 비용이 가장 적은 것 */
  function recommend(v, r) {
    const d = dsr(v, r);
    const paths = [
      { key: "A", name: "사내대출로 사서 그대로 갚기", sim: r.A, ok: r.fc.shortfall === 0 && d.A <= DSR_MAX,
        why: r.fc.shortfall > 0 ? "자금이 부족합니다" : d.A > DSR_MAX ? `거치가 끝나면 원리금이 연봉의 ${d.A.toFixed(0)}%라 감당하기 어렵습니다` : "" },
      { key: "B", name: "사내대출로 사고 거치 끝나면 은행으로 갈아타기", sim: r.B, ok: r.fc.shortfall === 0,
        why: r.fc.shortfall > 0 ? "자금이 부족합니다" : r.repay > 0 ? `갈아탈 때 ${won(r.repay)}원은 직접 갚아야 합니다` : "" },
      { key: "C", name: "처음부터 은행 주담대", sim: r.C, ok: r.fb.shortfall === 0,
        why: r.fb.shortfall > 0 ? `DSR 40% 안에서 은행이 ${won(r.bankMax)}원만 빌려줘 ${won(r.fb.shortfall)}원이 모자랍니다` : r.dsrBound ? `DSR 40% 때문에 은행 대출이 ${won(r.bankMax)}원으로 줄었습니다` : "" }
    ];
    const ok = paths.filter(p => p.ok).sort((a, b) => a.sim.cumArr[N] - b.sim.cumArr[N]);
    return { best: ok[0] || null, paths, dsr: d };
  }

  /* 집값이 연 몇 % 오르면 10년 누적 비용이 월세와 같아지는지 */
  function breakEvenGrowth(r, sim) {
    const gap = sim.cumArr[N] - r.rentCum[N];
    if (gap <= 0) return 0;
    return (Math.pow(1 + gap / (r.P * 10000), 1 / 10) - 1) * 100;
  }

  /*
   * 순자산 비교 (연말 기준, 0~10년)
   * 둘 다 같은 자기자금으로 시작하고 매달 같은 돈을 씁니다. 덜 쓰는 쪽이 차액을 예금에 넣습니다.
   *  월세: 보증금 + 예금
   *  매수: 집값(연 g% 상승) − 남은 대출 + 예금
   */
  function netWorth(v, r, sim, g) {
    const dr = v.depRate / 1200, dep = v.rentDeposit * 10000;
    let buyAcc = v.own * 10000 - sim.f.ownUsed, rentAcc = v.own * 10000 - dep;
    const buy = [v.own * 10000 - r.costs], rent = [v.own * 10000];
    sim.m.forEach((o, k) => {
      buyAcc *= 1 + dr; rentAcc *= 1 + dr;
      const diff = o.cash - v.rentMonthly;
      if (diff > 0) rentAcc += diff; else buyAcc -= diff;
      buyAcc -= o.lump; // 갈아탈 때 직접 갚는 돈은 모아둔 돈에서
      if ((k + 1) % 12 === 0) {
        const t = (k + 1) / 12;
        buy.push(r.P * 10000 * Math.pow(1 + g / 100, t) - o.debt + buyAcc);
        rent.push(dep + rentAcc);
      }
    });
    return { buy, rent };
  }

  /* 통화량이 연 m2% 늘 때, 지금 돈이 같은 몫을 유지하려면 필요한 금액 */
  const moneyLine = (start, m2) => Array.from({ length: 11 }, (_, t) => start * Math.pow(1 + m2 / 100, t));

  const api = { waitCost, dsrFactor, netMonthly, maxPriceSafe, netWorth, moneyLine, N, LIMIT, won, eok, pct, earnDed, insurance, incomeTax, taxBase, tax, refund, buyCosts, annuity, firstYear,
    funding, simulate, avg, maxPrice, maxPriceBank, dsr, recommend, breakEvenGrowth };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Homewise = api;
})(typeof window !== "undefined" ? window : globalThis);
