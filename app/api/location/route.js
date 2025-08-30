import { NextResponse } from "next/server";
import axios from "axios";



export const runtime = "nodejs";

const CSV_EMBED = `city,lat,lng
北京,39.904,116.407
上海,31.23,121.474
天津,39.084,117.361
重庆,29.563,106.551
石家庄,38.042,114.514
太原,37.87,112.548
呼和浩特,40.842,111.749
沈阳,41.805,123.431
长春,43.817,125.324
哈尔滨,45.803,126.534
南京,32.061,118.778
杭州,30.274,120.155
合肥,31.861,117.284
福州,26.074,119.297
南昌,28.682,115.858
济南,36.651,117.12
郑州,34.746,113.625
武汉,30.592,114.305
长沙,28.228,112.939
广州,23.129,113.264
南宁,22.817,108.366
海口,20.044,110.192
成都,30.572,104.066
贵阳,26.647,106.63
昆明,25.038,102.718
拉萨,29.65,91.1
西安,34.341,108.94
兰州,36.061,103.834
西宁,36.617,101.766
银川,38.487,106.231
乌鲁木齐,43.825,87.616
台北,25.033,121.565
香港,22.3,114.2
澳门,22.167,113.55
葫芦岛市,40.711,120.836
兴城市,40.616,120.716
beijing,39.904,116.407
shanghai,31.23,121.474
tianjin,39.084,117.361
chongqing,29.563,106.551
shijiazhuang,38.042,114.514
taiyuan,37.87,112.548
huhehaote,40.842,111.749
shenyang,41.805,123.431
changchun,43.817,125.324
haerbin,45.803,126.534
nanjing,32.061,118.778
hangzhou,30.274,120.155
hefei,31.861,117.284
fuzhou,26.074,119.297
nanchang,28.682,115.858
jinan,36.651,117.12
zhengzhou,34.746,113.625
wuhan,30.592,114.305
changsha,28.228,112.939
guangzhou,23.129,113.264
nanning,22.817,108.366
haikou,20.044,110.192
chengdu,30.572,104.066
guiyang,26.647,106.63
kunming,25.038,102.718
lhasa,29.65,91.1
xian,34.341,108.94
lanzhou,36.061,103.834
xining,36.617,101.766
yinchuan,38.487,106.231
wulumuqi,43.825,87.616
taipei,25.033,121.565
hongkong,22.3,114.2
macau,22.167,113.55
huludaoshi,40.711,120.836
xingchengshi,40.616,120.716
`;

function normalizeCity(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "") // 去除 BOM
    .replace(/[\s\u3000]+/g, "")
    .replace(/[·•・．.\-_,，。\/\\]+/g, "")
    .replace(/(特别行政区|自治州|自治区|地区|市辖区|省|市|区|县|盟)$/u, "");
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

    const content = CSV_EMBED;

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

      if (cityVal === target || target.includes(cityVal) || cityVal.includes(target)) {
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
      return NextResponse.json({ code: 400, data: null }, { status: 400 });
    }

    // 1) 本地 CSV 查询
    const local = await getLocalLatLng(city);
    if (local) {
      const { lat, lng } = local;
      return NextResponse.json({
        code: 200,
        data: { lat, lng },
      });
    }

    // 2) 调用高德API
    const key = process.env.AMAP_KEY;
    if (!key) {
      return NextResponse.json({ code: 400, data: null }, { status: 400 });
    }
    const url = "https://restapi.amap.com/v3/geocode/geo";
    const res = await axios.get(url, {
      params: { key, address: city },
    });
    const data = res.data;
    if (data?.status !== "1" || !data?.geocodes?.length) {
      return NextResponse.json({ code: 400, data: null }, { status: 400 });
    }
    const loc = data.geocodes[0].location; // "lng,lat"
    const [lngStr, latStr] = (loc || "").split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!isFinite(lat) || !isFinite(lng)) {
      return NextResponse.json({ code: 400, data: null }, { status: 400 });
    }
    return NextResponse.json({
      code: 200,
      data: { lat, lng },
    });
  } catch {
    return NextResponse.json({ code: 400, data: null }, { status: 400 });
  }
}
