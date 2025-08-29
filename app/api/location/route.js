import { NextResponse } from "next/server";
import axios from "axios";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

function normalizeCity(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/^\uFEFF/, "") // 去除 BOM
    .replace(/(市|区|县)$/u, "");
}

function tryReadUtf8(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseCsv(content) {
  // 简单 CSV 解析：按行分割、逗号分列；支持 UTF-8 BOM；不处理嵌套逗号（当前数据无需）
  const text = content.replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { header: [], rows: [] };

  const split = (line) =>
    line
      .split(",")
      .map((x) => x.trim().replace(/^"(.*)"$/s, "$1").replace(/^\uFEFF/, ""));

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map(split);
  return { header, rows };
}

function findIndex(header, aliases) {
  const set = new Set(aliases.map((a) => a.toLowerCase()));
  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase();
    if (set.has(h)) return i;
  }
  // 模糊包含匹配
  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase();
    if (aliases.some((a) => h.includes(a.toLowerCase()))) return i;
  }
  return -1;
}

async function getLocalLatLng(cityInput) {
  try {
    const target = normalizeCity(cityInput);

    const csvPath = path.join(process.cwd(), "app", "api", "location", "lat_lng.csv");
    const content = tryReadUtf8(csvPath);
    if (!content) return null;

    const { header, rows } = parseCsv(content);
    if (!header.length || !rows.length) return null;

    const cityIdx = findIndex(header, ["city", "城市", "name", "名称", "地名"]);
    const latIdx = findIndex(header, ["lat", "latitude", "纬度"]);
    const lngIdx = findIndex(header, ["lng", "lon", "long", "经度", "longitude"]);
    if (cityIdx < 0 || latIdx < 0 || lngIdx < 0) return null;

    for (const cols of rows) {
      if (cols.length <= Math.max(cityIdx, latIdx, lngIdx)) continue;
      const cityVal = normalizeCity(cols[cityIdx]);
      if (!cityVal) continue;

      if (cityVal === target) {
        const lat = Number(cols[latIdx]);
        const lng = Number(cols[lngIdx]);
        if (isFinite(lat) && isFinite(lng)) {
          return { lat, lng };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * POST /api/location
 * body: { city: string }
 * resp: { code: 200, data: { lat: number, lng: number }, msg?: string } | { code: 400, msg: string }
 * 说明：优先从本地 CSV 获取，找不到再调用高德地理编码API
 * 在 Vercel 项目设置中配置环境变量 AMAP_KEY
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const city = (body?.city || "").trim();
    if (!city) {
      return NextResponse.json({ code: 400, msg: "城市不能为空" }, { status: 400 });
    }

    // 1) 本地 CSV 查询
    const local = await getLocalLatLng(city);
    if (local) {
      const { lat, lng } = local;
      return NextResponse.json({
        code: 200,
        data: { lat, lng },
        msg: `获取经纬度成功，lat${lat}, lon${lng}`,
      });
    }

    // 2) 调用高德API
    const key = process.env.AMAP_KEY;
    if (!key) {
      return NextResponse.json({ code: 400, msg: "缺少 AMAP_KEY 环境变量" }, { status: 400 });
    }
    const url = "https://restapi.amap.com/v3/geocode/geo";
    const res = await axios.get(url, {
      params: { key, address: city },
    });
    const data = res.data;
    if (data?.status !== "1" || !data?.geocodes?.length) {
      return NextResponse.json({ code: 400, msg: "获取经纬度失败" }, { status: 400 });
    }
    const loc = data.geocodes[0].location; // "lng,lat"
    const [lngStr, latStr] = (loc || "").split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!isFinite(lat) || !isFinite(lng)) {
      return NextResponse.json({ code: 400, msg: "获取经纬度失败" }, { status: 400 });
    }
    return NextResponse.json({
      code: 200,
      data: { lat, lng },
      msg: `搜索经纬度成功，lat${lat}, lon${lng}`,
    });
  } catch {
    return NextResponse.json({ code: 400, msg: "获取经纬度失败" }, { status: 400 });
  }
}
