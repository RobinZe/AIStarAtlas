import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 纯 JS/WASM 替代版：不依赖 swisseph
 * - 太阳：近似精度良好（用于星座判定足够）
 * - 月亮：简化级数（度级精度，判定星座足够）
 * - 上升/宫位：等宫制（Equal House），用 GMST/LST 与黄赤交角计算上升点
 *
 * POST /api/astrology
 * body: { year, month, day, hour, minute, latitude/longitude 或 lat/lng, tzOffset? }
 * 返回:
 *  {
 *    code: 200,
 *    data: {
 *      sunSign: string,
 *      moonSign: string,
 *      ascendant: string,
 *      houses: Array<{ index: number, sign: string, meaning: string }>
 *    }
 *  }
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

    // 本地时间 -> UTC（统一使用客户端 tzOffset；缺失时回退为 -480，避免受服务端时区影响）
    const tzOffRaw = toNumber(tzOffset);
    const tzOffNum = Number.isFinite(tzOffRaw) ? tzOffRaw : -480;
    // 公式：UTC_ms = Date.UTC(本地组件) + tzOffset*60*1000
    // 例：上海 tzOffset = -480，本地 10:00 -> UTC 02:00
    const utcMs = Date.UTC(yearNum, monthNum - 1, dayNum, hourNum, minuteNum) + tzOffNum * 60 * 1000;
    const utc = new Date(utcMs);
    const uYear = utc.getUTCFullYear();
    const uMonth = utc.getUTCMonth() + 1;
    const uDay = utc.getUTCDate();
    const uHour = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600;

    // 儒略日（UTC）
    const jd = julianDay(uYear, uMonth, uDay, uHour);
    const T = (jd - 2451545.0) / 36525.0; // 世纪数

    // 太阳与月亮黄经（度）
    const sunLon = normalizeDeg(sunLongitude(T));
    const moonLon = normalizeDeg(moonLongitudeApprox(T));

    const sunSign = lonToSignName(sunLon);
    const moonSign = lonToSignName(moonLon);

    // 上升与等宫制
    const eps = deg2rad(meanObliquity(T));         // 黄赤交角（弧度）
    const thetaG = normalizeDeg(gmst(jd, T));      // 格林尼治平恒星时（度）
    const lstDeg = normalizeDeg(thetaG + lngNum);  // 当地平恒星时（度）
    const theta = deg2rad(lstDeg);                 // 恒星时（弧度）
    const phi = deg2rad(latNum);                   // 纬度（弧度）

    const ascLon = ascendantLongitude(theta, phi, eps); // 度
    const ascendant = lonToSignName(ascLon);

    // 等宫制 12 宫（每 30°）
    let houses = Array.from({ length: 12 }, (_, i) => {
      const deg = normalizeDeg(ascLon + i * 30);
      return {
        index: i + 1,
        sign: lonToSignName(deg),
        meaning: houseMeaning(i + 1)
      };
    });

    const debugFlag = body && (body.debug === 1 || body.debug === true || body._debug === 1 || body._debug === true);
    const debugInfo = debugFlag ? { tzOffNum, utc: utc.toISOString(), jd, T, sunLon, moonLon, ascLon, latNum, lngNum } : undefined;

    return NextResponse.json({
      code: 200,
      data: {
        sunSign,
        moonSign,
        ascendant,
        houses
      },
      ...(debugInfo ? { debug: debugInfo } : {})
    });
  } catch (e) {
    return NextResponse.json({ code: 400, msg: "星盘计算失败" });
  }
}

/* ==========================
   纯 JS 天文计算辅助函数
   ========================== */

function julianDay(year, month, day, hourDecimal) {
  // Meeus: 算法（格里历）
  let y = year;
  let m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const dayFrac = day + (hourDecimal / 24);
  const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayFrac + B - 1524.5;
  return jd;
}

function sunLongitude(T) {
  // 低阶近似（Meeus）
  const M = deg2rad(normalizeDeg(357.52911 + 35999.05029 * T - 0.0001537 * T * T));
  const L0 = normalizeDeg(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  return L0 + C; // 真黄经（度）
}

function moonLongitudeApprox(T) {
  // 简化级数（度级精度，足以判定星座）
  // L'（月亮平黄经）
  const Lp = normalizeDeg(
    218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
  );
  // 太阳平近点角 M、月亮平近点角 M'、月亮纬度参数 F、日月角距 D
  const M = normalizeDeg(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = normalizeDeg(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
  const F = normalizeDeg(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T);
  const D = normalizeDeg(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);

  // 主要项修正（度）
  const term =
    6.289 * Math.sin(deg2rad(Mp)) +
    1.274 * Math.sin(deg2rad(2 * D - Mp)) +
    0.658 * Math.sin(deg2rad(2 * D)) +
    0.214 * Math.sin(deg2rad(2 * Mp)) -
    0.186 * Math.sin(deg2rad(M)) -
    0.114 * Math.sin(deg2rad(2 * F));
  return normalizeDeg(Lp + term);
}

function meanObliquity(T) {
  // 黄赤交角均值（度），近似
  return 23.439291 - 0.0130042 * T;
}

function gmst(jd, T) {
  // 格林尼治平恒星时（度）
  // 公式（近似）：θ0 = 280.46061837 + 360.98564736629*(JD - 2451545)
  //                + 0.000387933*T^2 - T^3/38710000
  const theta =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000.0;
  return normalizeDeg(theta);
}

function ascendantLongitude(theta, phi, eps) {
  // 上升点黄经（度）
  // λAsc = atan2( -cosθ, sinθ·cosε + tanφ·sinε )
  const y = -Math.cos(theta);
  const x = Math.sin(theta) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps);
  let lambda = Math.atan2(y, x); // 弧度
  if (lambda < 0) lambda += 2 * Math.PI;
  return rad2deg(lambda);
}

/* ==========================
   公用小工具
   ========================== */
function lonToSignName(lon) {
  const n = Number(lon);
  if (!Number.isFinite(n)) return "未知";
  const i = Math.floor(((n % 360) + 360) % 360 / 30);
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
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function normalizeDeg(a) {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}
function deg2rad(d) { return d * Math.PI / 180; }
function rad2deg(r) { return r * 180 / Math.PI; }
