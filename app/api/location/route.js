import { NextResponse } from "next/server";
import axios from "axios";

/**
 * POST /api/location
 * body: { city: string }
 * resp: { code: 200, data: { lat: number, lng: number } } | { code: 400, msg: string }
 * 说明：调用高德地理编码API，根据城市名解析经纬度
 * 在 Vercel 项目设置中配置环境变量 AMAP_KEY
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const city = (body?.city || "").trim();
    if (!city) {
      return NextResponse.json({ code: 400, msg: "城市不能为空" }, { status: 400 });
    }
    const key = process.env.AMAP_KEY;
    if (!key) {
      return NextResponse.json({ code: 400, msg: "缺少 AMAP_KEY 环境变量" }, { status: 400 });
    }
    const url = "https://restapi.amap.com/v3/geocode/geo";
    const res = await axios.get(url, {
      params: { key, address: city }
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
    return NextResponse.json({ code: 200, data: { lat, lng } });
  } catch (e) {
    return NextResponse.json({ code: 400, msg: "获取经纬度失败" }, { status: 400 });
  }
}