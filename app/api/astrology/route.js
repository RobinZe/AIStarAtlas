import { NextResponse } from "next/server";
import path from "path";
export const runtime = "nodejs";

/**
 * POST /api/astrology
 * body: { year, month, day, hour, minute, latitude/longitude 或 lat/lng, tzOffset? }
 * 返回: {
 *  code: 200,
 *  data: {
 *    sunSign: string,
 *    moonSign: string,
 *    ascendant: string,
 *    houses: Array<{ index: number, sign: string, meaning: string }>
 *  }
 * }
 * 说明：
 * - 使用 swisseph 以UTC时间计算太阳、月亮、上升及12宫位
 * - 需确保 swisseph 能找到星历表（默认指向 node_modules/swisseph/ephe）
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { year, month, day, hour, minute, lat, lng, latitude, longitude, tzOffset } = body || {};

    // 统一转数值与字段兼容（优先 latitude/longitude）
    const yearNum = toNumber(year);
    const monthNum = toNumber(month);
    const dayNum = toNumber(day);
    const hourNum = toNumber(hour);
    const minuteNum = toNumber(minute);

    const latVal = (latitude !== undefined && latitude !== null ? latitude : lat);
    const lngVal = (longitude !== undefined && longitude !== null ? longitude : lng);

    if (![yearNum, monthNum, dayNum, hourNum, minuteNum].every(n => Number.isFinite(n))) {
      return NextResponse.json({ code: 400, msg: "参数不完整或非法：year/month/day/hour/minute" });
    }
    if (latVal === undefined || latVal === null || latVal === "") {
      return NextResponse.json({ code: 400, msg: "缺少经纬度：支持 latitude/longitude 或 lat/lng" });
    }
    if (lngVal === undefined || lngVal === null || lngVal === "") {
      return NextResponse.json({ code: 400, msg: "缺少经纬度：支持 latitude/longitude 或 lat/lng" });
    }
    const latNum = toNumber(latVal);
    const lngNum = toNumber(lngVal);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return NextResponse.json({ code: 400, msg: "经纬度需为数字" });
    }
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return NextResponse.json({ code: 400, msg: "经纬度数值非法：lat ∈ [-90,90]，lng ∈ [-180,180]" });
    }

    // 本地时间 -> UTC
    // 若提供客户端 tzOffset(分钟, 为 Date.getTimezoneOffset 的值)，按其计算，避免受服务端时区影响
    let utc;
    const tzOffNum = toNumber(tzOffset);
    if (Number.isFinite(tzOffNum)) {
      // 公式：UTC_ms = Date.UTC(本地组件) + tzOffset*60*1000
      // 例：上海 tzOffset = -480，本地 10:00 -> UTC 02:00
      const utcMs = Date.UTC(yearNum, monthNum - 1, dayNum, hourNum, minuteNum) + tzOffNum * 60 * 1000;
      utc = new Date(utcMs);
    } else {
      const local = new Date(yearNum, monthNum - 1, dayNum, hourNum, minuteNum);
      utc = new Date(local.getTime());
    }
    const uYear = utc.getUTCFullYear();
    const uMonth = utc.getUTCMonth() + 1;
    const uDay = utc.getUTCDate();
    const uHour = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600;

    // swisseph 计算
    let sw;
    try {
      // 动态 require，避免被 webpack 解析 .node
      const nodeRequire = eval("require");
      const mod = nodeRequire("swisseph");
      sw = mod.default || mod;
    } catch (e) {
      // 提供降级（仅返回太阳星座近似）以便前端不崩溃
      const sunSign = approxSunSign({ year, month, day });
      return NextResponse.json({
        code: 200,
        data: {
          sunSign,
          moonSign: "未知",
          ascendant: "未知",
          houses: defaultHousesWithSign(sunSign)
        }
      });
    }

    // 设置星历路径（指向包内 ephe 目录），用 require.resolve 更稳妥
    try {
      const nodeRequire2 = eval("require");
      const pkgRoot = path.dirname(nodeRequire2.resolve("swisseph/package.json"));
      const ephePath = path.join(pkgRoot, "ephe");
      if (typeof sw.swe_set_ephe_path === "function") {
        sw.swe_set_ephe_path(ephePath);
      }
    } catch {}

    // 常量兜底
    const SE_GREG_CAL = sw.SE_GREG_CAL ?? sw.GREG_CAL ?? 1;
    const SEFLG_SWIEPH = sw.SEFLG_SWIEPH ?? sw.FLG_SWIEPH ?? 2;
    const SEFLG_SPEED = sw.SEFLG_SPEED ?? sw.FLG_SPEED ?? 256;
    const FLAGS = SEFLG_SWIEPH | SEFLG_SPEED;
    const SE_SUN = sw.SE_SUN ?? sw.SUN ?? 0;
    const SE_MOON = sw.SE_MOON ?? sw.MOON ?? 1;

    // 儒略日
    const jd = (typeof sw.swe_julday === "function")
      ? sw.swe_julday(uYear, uMonth, uDay, uHour, SE_GREG_CAL)
      : (typeof sw.julday === "function" ? sw.julday(uYear, uMonth, uDay, uHour, SE_GREG_CAL) : null);

    if (!jd) {
      const sunSign = approxSunSign({ year, month, day });
      return NextResponse.json({
        code: 200,
        data: {
          sunSign,
          moonSign: "未知",
          ascendant: "未知",
          houses: defaultHousesWithSign(sunSign)
        }
      });
    }

    // 计算行星黄经
    async function calcLon(ipl) {
      // 回调风格（Node swisseph 常用）
      if (typeof sw.swe_calc_ut === "function" && sw.swe_calc_ut.length >= 4) {
        return await new Promise((resolve, reject) => {
          sw.swe_calc_ut(jd, ipl, FLAGS, (res) => {
            const lon =
              (typeof res?.longitude === "number" && res.longitude) ||
              (typeof res?.lon === "number" && res.lon) ||
              (Array.isArray(res) && typeof res[0] === "number" && res[0]) ||
              (res?.xx && typeof res.xx[0] === "number" && res.xx[0]) ||
              (res?.x && typeof res.x[0] === "number" && res.x[0]);
            if (typeof lon === "number") resolve(lon);
            else reject(new Error("calc failed"));
          });
        });
      }
      // 兼容可能存在的同步实现
      if (typeof sw.swe_calc_ut === "function") {
        const r = sw.swe_calc_ut(jd, ipl, FLAGS);
        const lon =
          (typeof r?.longitude === "number" && r.longitude) ||
          (typeof r?.lon === "number" && r.lon) ||
          (Array.isArray(r) && typeof r[0] === "number" && r[0]) ||
          (r?.xx && typeof r.xx[0] === "number" && r.xx[0]) ||
          (r?.x && typeof r.x[0] === "number" && r.x[0]);
        if (typeof lon === "number") return lon;
      }
      throw new Error("swe_calc_ut not available");
    }

    // 计算宫位与上升（兼容不同API）
    async function calcHouses(latVal, lngVal) {
      // swe_houses(jd_ut, lat, lng, hsys)
      if (typeof sw.swe_houses === "function") {
        const r = sw.swe_houses(jd, Number(latVal), Number(lngVal), "P");
        return r;
      }
      if (typeof sw.swe_houses_ex === "function") {
        const r = sw.swe_houses_ex(jd, FLAGS, Number(latVal), Number(lngVal), "P");
        return r;
      }
      return null;
    }

    const sunLon = await calcSafely(() => calcLon(SE_SUN));
    const moonLon = await calcSafely(() => calcLon(SE_MOON));

    const sunSign = lonToSignName(sunLon);
    const moonSign = lonToSignName(moonLon);

    let ascSign = "未知";
    let houses = [];
    try {
      const h = await calcHouses(latNum, lngNum);
      // h.cusps: 1..12 宫首黄经（度）
      // h.ascmc: 0: ASC 黄经
      const cusps = h?.cusps || h?.house || [];
      const ascmc = h?.ascmc || h?.ascmc2 || [];
      const ascLon = Array.isArray(ascmc) ? (ascmc[0] ?? null) : null;
      if (typeof ascLon === "number") {
        ascSign = lonToSignName(ascLon);
      }
      houses = (cusps?.slice(1, 13) || []).map((deg, idx) => ({
        index: idx + 1,
        sign: lonToSignName(deg),
        meaning: houseMeaning(idx + 1)
      }));
      if (!houses.length) {
        houses = defaultHousesWithSign(sunSign);
      }
    } catch {
      houses = defaultHousesWithSign(sunSign);
    }

    return NextResponse.json({
      code: 200,
      data: {
        sunSign,
        moonSign,
        ascendant: ascSign,
        houses
      }
    });
  } catch (e) {
    return NextResponse.json({ code: 400, msg: "星盘计算失败" });
  }
}

// 辅助函数
function lonToSignName(lon) {
  if (typeof lon !== "number" || !isFinite(lon)) return "未知";
  const i = Math.floor(((lon % 360) + 360) % 360 / 30);
  const names = ["白羊座","金牛座","双子座","巨蟹座","狮子座","处女座","天秤座","天蝎座","射手座","摩羯座","水瓶座","双鱼座"];
  return names[i] || "未知";
}
function houseMeaning(i) {
  const m = {
    1: "第1宫：自我与形象、外在气质与开端",
    2: "第2宫：金钱与价值、资源与安全感",
    3: "第3宫：沟通与学习、手足与短途",
    4: "第4宫：家庭与根基、内在安全与私域",
    5: "第5宫：创造与恋爱、子女与表达",
    6: "第6宫：工作与健康、日常与服务",
    7: "第7宫：伴侣与合作、契约与投射",
    8: "第8宫：共享与转化、亲密与风险",
    9: "第9宫：高等教育、哲思与远行",
    10: "第10宫：事业与名誉、目标与社会角色",
    11: "第11宫：社群与愿景、朋友与资源",
    12: "第12宫：潜意识与疗愈、隐退与结束"
  };
  return m[i] || `第${i}宫`;
}
function defaultHousesWithSign(sign) {
  return Array.from({ length: 12 }, (_, i) => ({
    index: i + 1,
    sign,
    meaning: houseMeaning(i + 1)
  }));
}
// 近似太阳星座（备用）
function approxSunSign({ year, month, day }) {
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  const md = `${d.getMonth()+1}-${d.getDate()}`;
  const ranges = [
    ["白羊座","3-21","4-19"],["金牛座","4-20","5-20"],["双子座","5-21","6-21"],["巨蟹座","6-22","7-22"],
    ["狮子座","7-23","8-22"],["处女座","8-23","9-22"],["天秤座","9-23","10-23"],["天蝎座","10-24","11-22"],
    ["射手座","11-23","12-21"],["摩羯座","12-22","1-19"],["水瓶座","1-20","2-18"],["双鱼座","2-19","3-20"]
  ];
  const val = (s) => {
    const [m, d] = s.split("-").map(Number);
    return (m*100 + d);
  };
  const x = val(md);
  for (const [name, a, b] of ranges) {
    const va = val(a), vb = val(b);
    if (va <= vb) {
      if (x >= va && x <= vb) return name;
    } else {
      if (x >= va || x <= vb) return name;
    }
  }
  return "白羊座";
}
async function calcSafely(fn) {
  try { return await fn(); } catch { return NaN; }
}
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}
