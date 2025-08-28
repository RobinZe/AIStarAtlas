import { NextResponse } from "next/server";
import axios from "axios";

/**
 * POST /api/image
 * body: { astrologyData: object, currentMonth: string }
 * resp: { code: 200, data: { natalChartUrl: string, fortuneUrl: string } }
 * 说明：
 * - 读取 TONGYI_API_KEY、TONGYI_API_URL 环境变量，调用通义万象生成两张图
 * - 若未配置密钥，则返回占位图用于前端验证流程
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { astrologyData, currentMonth } = body || {};
    if (!astrologyData || !currentMonth) {
      return NextResponse.json({ code: 400, msg: "参数不完整" });
    }
    const apiKey = process.env.TONGYI_API_KEY;
    const apiUrl = process.env.TONGYI_API_URL || "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation";
    const model = process.env.TONGYI_IMAGE_MODEL || "wanx-v1";

    const natalPrompt = buildNatalPrompt(astrologyData);
    const fortunePrompt = buildFortunePrompt(astrologyData, currentMonth);

    // 无密钥时返回占位（便于开发联调）
    if (!apiKey) {
      const natalChartUrl = `https://dummyimage.com/800x800/ede9fe/6b21a8.png&text=${encodeURIComponent("星盘图(示例)")}`;
      const fortuneUrl = `https://dummyimage.com/800x800/e0f2fe/0369a1.png&text=${encodeURIComponent(`${currentMonth}运势(示例)`)}`;
      return NextResponse.json({ code: 200, data: { natalChartUrl, fortuneUrl } });
    }

    const [natalChartUrl, fortuneUrl] = await Promise.all([
      callTongyi(apiUrl, apiKey, natalPrompt, model),
      callTongyi(apiUrl, apiKey, fortunePrompt, model),
    ]);

    if (!natalChartUrl || !fortuneUrl) {
      return NextResponse.json({ code: 400, msg: "图片生成失败" });
    }

    return NextResponse.json({ code: 200, data: { natalChartUrl, fortuneUrl } });
  } catch (e) {
    return NextResponse.json({ code: 400, msg: "图片生成失败" });
  }
}

function buildNatalPrompt(astrologyData) {
  const { sunSign, moonSign, ascendant } = astrologyData || {};
  return [
    "生成一张出生日星盘图：",
    "包含12宫位、太阳/月亮/行星标记，标注星座符号。",
    "风格：简约手绘风，背景浅紫色、干净柔和。",
    `提示信息：太阳：${sunSign}；月亮：${moonSign}；上升：${ascendant}。`,
    "画面清晰，线条细腻，构图规整，中文友好，不添加水印。"
  ].join("\n");
}

function signTone(sign) {
  const map = {
    "白羊座":"活力果敢，行动迅速；",
    "金牛座":"稳健务实，重视价值与安全；",
    "双子座":"灵动机敏，沟通学习旺盛；",
    "巨蟹座":"温柔敏感，重视家庭与情感；",
    "狮子座":"自信大方，表达与创造力强；",
    "处女座":"细致严谨，注重效率与健康；",
    "天秤座":"优雅平衡，善于合作与审美；",
    "天蝎座":"深刻专注，洞察力与意志强；",
    "射手座":"乐观开阔，远见与探索欲强；",
    "摩羯座":"坚毅负责，目标与自律突出；",
    "水瓶座":"独立理性，创新与社群意识；",
    "双鱼座":"浪漫感性，疗愈与共情力强；"
  };
  return map[sign] || "";
}
function buildFortunePrompt(astrologyData, currentMonth) {
  const { sunSign } = astrologyData || {};
  const baseText = `本月事业有贵人相助，需注意情绪管理，财运平稳。`;
  const tone = signTone(sunSign);
  return [
    "生成一张本月运势图：",
    `包含用户星座符号（${sunSign || "未知星座"}）、本月日期（${currentMonth}）、运势文本（结合太阳星座特质，模板：${baseText}）。`,
    "风格：清新治愈，配色以该星座代表色为主，画面干净、温暖。",
    "排版整洁，中文可读性强，适合社交媒体分享。",
  ].join("\n") + `\n星座性格倾向：${tone}`;
}

 // 通义万象API调用（按阿里云 DashScope Image Generation 协议）
async function callTongyi(apiUrl, apiKey, prompt, model) {
  try {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
    const payload = {
      model,
      input: {
        prompt,
        size: "1024*1024",
        n: 1
      }
      // 可按需添加 parameters: { ... }（如风格、seed 等），遵循官方文档
    };
    const res = await axios.post(apiUrl, payload, { headers, timeout: 60000 });
    const data = res.data;

    // 按官方返回结构解析
    const result = data?.output?.results?.[0];
    const url = result?.url || result?.urls?.image_url;
    if (url) return url;

    // 若返回base64字段
    const b64 = result?.b64_json || data?.image_base64;
    if (typeof b64 === "string" && b64) {
      return `data:image/png;base64,${b64}`;
    }
    return "";
  } catch {
    return "";
  }
}
