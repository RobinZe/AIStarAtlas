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
  try {
    // 确保内容是字符串并处理编码问题
    const text = String(content)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      console.warn('CSV内容不足:', lines.length);
      return { header: [], rows: [] };
    }

    const split = (line) =>
      line
        .split(",")
        .map((x) => x.trim().replace(/^"(.*)"$/s, "$1").replace(/^\uFEFF/, ""));

    const header = split(lines[0]).map((h) => h.toLowerCase());
    const rows = lines.slice(1).map(split);
    
    console.log('CSV解析结果:', { header, rowCount: rows.length, firstRow: rows[0] });
    return { header, rows };
  } catch (error) {
    console.error('CSV解析错误:', error);
    return { header: [], rows: [] };
  }
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
    console.log('查找城市:', cityInput, '标准化后:', target);

    const content = CSV_EMBED;
    console.log('CSV内容长度:', content.length, '前100字符:', content.substring(0, 100));

    const { header, rows } = parseCsv(content);
    if (!header.length || !rows.length) {
      console.warn('CSV解析失败');
      return null;
    }

    const cityIdx = findIndex(header, ["city", "城市", "name", "名称", "地名"]);
    const latIdx = findIndex(header, ["lat", "latitude", "纬度"]);
    const lngIdx = findIndex(header, ["lng", "lon", "long", "经度", "longitude"]);
    
    console.log('列索引:', { cityIdx, latIdx, lngIdx, header });
    
    if (cityIdx < 0 || latIdx < 0 || lngIdx < 0) {
      console.warn('必要的列未找到');
      return null;
    }

    for (const cols of rows) {
      if (cols.length <= Math.max(cityIdx, latIdx, lngIdx)) continue;
      
      const cityVal = normalizeCity(cols[cityIdx]);
      if (!cityVal) continue;

      if (cityVal === target || target.includes(cityVal) || cityVal.includes(target)) {
        const lat = Number(cols[latIdx]);
        const lng = Number(cols[lngIdx]);
        
        if (isFinite(lat) && isFinite(lng)) {
          console.log('找到匹配城市:', cols[cityIdx], { lat, lng });
          return { lat, lng };
        }
      }
    }
    
    console.log('未找到匹配城市');
    return null;
  } catch (error) {
    console.error('本地经纬度查找错误:', error);
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
      return NextResponse.json({ code: 400, data: null, msg: "城市名称不能为空" }, { status: 400 });
    }

    // 添加环境信息
    const envInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      currentTime: new Date().toISOString()
    };
    console.log('环境信息:', envInfo);

    // 1) 本地 CSV 查询
    const local = await getLocalLatLng(city);
    if (local) {
      const { lat, lng } = local;
      return NextResponse.json({
        code: 200,
        data: { lat, lng },
        source: 'local'
      });
    }

    // 2) 调用高德API
    const key = process.env.AMAP_KEY;
    if (!key) {
      console.warn('高德API密钥未配置');
      return NextResponse.json({ 
        code: 400, 
        data: null, 
        msg: "高德API密钥未配置，无法获取经纬度" 
      }, { status: 400 });
    }
    
    console.log('调用高德API获取城市:', city);
    const url = "https://restapi.amap.com/v3/geocode/geo";
    const res = await axios.get(url, {
      params: { key, address: city },
      timeout: 10000 // 10秒超时
    });
    
    const data = res.data;
    if (data?.status !== "1" || !data?.geocodes?.length) {
      console.warn('高德API返回错误:', data);
      return NextResponse.json({ 
        code: 400, 
        data: null, 
        msg: "高德API查询失败" 
      }, { status: 400 });
    }
    
    const loc = data.geocodes[0].location; // "lng,lat"
    const [lngStr, latStr] = (loc || "").split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    
    if (!isFinite(lat) || !isFinite(lng)) {
      console.warn('高德API返回的经纬度无效:', loc);
      return NextResponse.json({ 
        code: 400, 
        data: null, 
        msg: "高德API返回的经纬度无效" 
      }, { status: 400 });
    }
    
    console.log('高德API成功获取:', city, { lat, lng });
    return NextResponse.json({
      code: 200,
      data: { lat, lng },
      source: 'amap'
    });
  } catch (error) {
    console.error('经纬度获取错误:', error);
    return NextResponse.json({ 
      code: 400, 
      data: null, 
      msg: "经纬度获取失败",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 400 });
  }
}
