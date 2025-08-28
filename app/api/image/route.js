import { NextResponse } from "next/server";

/**
 * POST /api/image
 * 请求1：提交生成
 *  body: { astrologyData: object, currentMonth: string }
 *  resp:
 *    - 若短轮询内完成: { code: 200, data: { natalChartUrl, fortuneUrl } }
 *    - 若未完成: { code: 202, msg: "任务已提交，生成中...", data: { taskIds: { natal, fortune }, partial?: { natalChartUrl?, fortuneUrl? }, nextPollAfterMs } }
 *
 * 请求2：轮询结果
 *  body: { taskIds: { natal: string, fortune: string } }
 *  resp:
 *    - 完成: { code: 200, data: { natalChartUrl, fortuneUrl } }
 *    - 未完成: { code: 202, msg: "生成中...", data: { taskIds, partial?, nextPollAfterMs } }
 *
 * 说明：
 * - 使用通义万象异步生成端点 + 轮询 tasks 接口
 * - 环境变量：TONGYI_API_KEY、TONGYI_API_URL（可选，默认 DashScope 异步端点）、TONGYI_IMAGE_MODEL
 * - “一半时间”短轮询策略：maxPolls = (timeoutMs/2) / intervalMs
 */

const DEFAULT_ASYNC_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-async-synthesis";
const TASK_URL_PREFIX = "https://dashscope.aliyuncs.com/api/v1/tasks/";

export async function POST(req) {
  try {
    const body = await req.json();
    const { astrologyData, currentMonth, taskIds } = body || {};

    const apiKey = process.env.TONGYI_API_KEY;
    const envUrl = process.env.TONGYI_API_URL;
    const model = process.env.TONGYI_IMAGE_MODEL || "wanx-v1";

    if (!apiKey) {
      return NextResponse.json(
        { code: 500, msg: "未配置 TONGYI_API_KEY" },
        { status: 500 }
      );
    }

    const apiUrl = sanitizeApiUrl(envUrl, DEFAULT_ASYNC_URL);

    // 轮询模式：客户端带 taskIds 进来只做查询
    if (taskIds?.natal && taskIds?.fortune) {
      const pollOpts = defaultPollOptions();
      const result = await pollBoth(apiKey, taskIds, pollOpts);
      if (result.done) {
        return NextResponse.json({
          code: 200,
          data: {
            natalChartUrl: result.urls.natal || "",
            fortuneUrl: result.urls.fortune || "",
          },
        });
      }
      return NextResponse.json(
        {
          code: 202,
          msg: "生成中...",
          data: {
            taskIds,
            partial: buildPartial(result.urls),
            nextPollAfterMs: pollOpts.intervalMs,
          },
        },
        { status: 202 }
      );
    }

    // 提交生成任务
    if (!astrologyData || !currentMonth) {
      return NextResponse.json({ code: 400, msg: "参数不完整" }, { status: 400 });
    }

    const natalPrompt = buildNatalPrompt(astrologyData);
    const fortunePrompt = buildFortunePrompt(astrologyData, currentMonth);

    // 并发提交两张图的异步任务
    const [natalTask, fortuneTask] = await Promise.all([
      submitAsync(apiUrl, apiKey, natalPrompt, model),
      submitAsync(apiUrl, apiKey, fortunePrompt, model),
    ]);

    if (!natalTask || !fortuneTask) {
      return NextResponse.json(
        { code: 500, msg: "任务提交失败，请稍后重试" },
        { status: 500 }
      );
    }

    const submittedTaskIds = { natal: natalTask, fortune: fortuneTask };

    // 短轮询（按照一半的时间设置最大轮询次数）
    const pollOpts = defaultPollOptions();
    const shortResult = await pollBoth(apiKey, submittedTaskIds, pollOpts);

    if (shortResult.done) {
      return NextResponse.json({
        code: 200,
        data: {
          natalChartUrl: shortResult.urls.natal || "",
          fortuneUrl: shortResult.urls.fortune || "",
        },
      });
    }

    // 未在短轮询窗口内完成，返回 202 + 任务号，让前端显示“生成中...”并继续轮询
    return NextResponse.json(
      {
        code: 202,
        msg: "任务已提交，生成中...",
        data: {
          taskIds: submittedTaskIds,
          partial: buildPartial(shortResult.urls),
          nextPollAfterMs: pollOpts.intervalMs,
        },
      },
      { status: 202 }
    );
  } catch (e) {
    console.error("image route error:", e?.message || e);
    return NextResponse.json(
      { code: 500, msg: "图片生成失败" },
      { status: 500 }
    );
  }
}

function buildNatalPrompt(astrologyData) {
  const { sunSign, moonSign, ascendant } = astrologyData || {};
  return [
    "生成一张出生日星盘图：",
    "包含12宫位、太阳/月亮/行星标记，标注星座符号。",
    "风格：简约手绘风，背景浅紫色、干净柔和。",
    `提示信息：太阳：${sunSign}；月亮：${moonSign}；上升：${ascendant}。`,
    "画面清晰，线条细腻，构图规整，中文友好，不添加水印。",
  ].join("\n");
}

function signTone(sign) {
  const map = {
    白羊座: "活力果敢，行动迅速；",
    金牛座: "稳健务实，重视价值与安全；",
    双子座: "灵动机敏，沟通学习旺盛；",
    巨蟹座: "温柔敏感，重视家庭与情感；",
    狮子座: "自信大方，表达与创造力强；",
    处女座: "细致严谨，注重效率与健康；",
    天秤座: "优雅平衡，善于合作与审美；",
    天蝎座: "深刻专注，洞察力与意志强；",
    射手座: "乐观开阔，远见与探索欲强；",
    摩羯座: "坚毅负责，目标与自律突出；",
    水瓶座: "独立理性，创新与社群意识；",
    双鱼座: "浪漫感性，疗愈与共情力强；",
  };
  return map[sign] || "";
}

function buildFortunePrompt(astrologyData, currentMonth) {
  const { sunSign } = astrologyData || {};
  const baseText = `本月事业有贵人相助，需注意情绪管理，财运平稳。`;
  const tone = signTone(sunSign);
  return (
    [
      "生成一张本月运势图：",
      `包含用户星座符号（${sunSign || "未知星座"}）、本月日期（${currentMonth}）、运势文本（结合太阳星座特质，模板：${baseText}）。`,
      "风格：清新治愈，配色以该星座代表色为主，画面干净、温暖。",
      "排版整洁，中文可读性强，适合社交媒体分享。",
    ].join("\n") + `\n星座性格倾向：${tone}`
  );
}

/** 提交异步任务，返回 task_id */
async function submitAsync(apiUrl, apiKey, prompt, model, timeoutMs = 60000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    const payload = {
      model,
      input: { prompt },
      parameters: {
        size: "1024*1024",
        n: 1,
      },
    };
    const res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      let errJson = null;
      try {
        errJson = await res.json();
      } catch {}
      throw new Error(
        `submit API error: ${res.status} - ${res.statusText}${
          errJson ? " - " + JSON.stringify(errJson) : ""
        }`
      );
    }
    const data = await res.json();
    const taskId =
      data?.output?.task_id ||
      data?.task_id ||
      data?.output?.taskId ||
      data?.taskId;
    if (!taskId) {
      throw new Error("submit API no task_id");
    }
    return taskId;
  } catch (err) {
    console.error("submitAsync error:", err?.message || err);
    return "";
  } finally {
    clearTimeout(t);
  }
}

/** 查询单个任务状态 */
async function fetchTask(apiKey, taskId, timeoutMs = 30000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${TASK_URL_PREFIX}${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    // 某些情况下不严格 2xx 也会有 JSON
    if (!res.ok && data) {
      // 把服务端的错误透出到日志
      console.error(
        "fetchTask non-2xx:",
        res.status,
        res.statusText,
        JSON.stringify(data)
      );
    }
    return data || {};
  } catch (err) {
    console.error("fetchTask error:", err?.message || err);
    return {};
  } finally {
    clearTimeout(t);
  }
}

/** 从任务返回中提取状态与图片URL */
function parseTaskResult(taskJson) {
  const status =
    taskJson?.output?.task_status ||
    taskJson?.task_status ||
    taskJson?.status ||
    "";
  const result = taskJson?.output?.results?.[0] || taskJson?.result?.[0] || null;
  const url =
    result?.url ||
    result?.urls?.image_url ||
    (result?.b64_json ? `data:image/png;base64,${result?.b64_json}` : "");
  return { status, url };
}

/** 半时长短轮询策略参数 */
function defaultPollOptions() {
  const timeoutMs = 120000; // 总预算 120s
  const intervalMs = 2000; // 每 2s 轮询一次
  const halfWindowMs = Math.floor(timeoutMs / 2); // 一半时间
  const maxPolls = Math.max(1, Math.floor(halfWindowMs / intervalMs));
  return { timeoutMs, intervalMs, maxPolls };
}

/** 轮询两个任务，返回是否全部完成与各自 URL（可能部分完成） */
async function pollBoth(apiKey, taskIds, opts) {
  const { intervalMs, maxPolls } = opts;
  let urls = { natal: "", fortune: "" };
  let finished = { natal: false, fortune: false };

  for (let i = 0; i < maxPolls; i++) {
    // 并发查询尚未完成的任务
    const [natalJson, fortuneJson] = await Promise.all([
      finished.natal ? Promise.resolve(null) : fetchTask(apiKey, taskIds.natal),
      finished.fortune
        ? Promise.resolve(null)
        : fetchTask(apiKey, taskIds.fortune),
    ]);

    if (natalJson) {
      const { status, url } = parseTaskResult(natalJson);
      if (status === "SUCCEEDED") {
        finished.natal = true;
        urls.natal = url || urls.natal;
      } else if (status === "FAILED" || status === "CANCELED") {
        // 标记完成但无URL（失败）
        finished.natal = true;
      }
    }

    if (fortuneJson) {
      const { status, url } = parseTaskResult(fortuneJson);
      if (status === "SUCCEEDED") {
        finished.fortune = true;
        urls.fortune = url || urls.fortune;
      } else if (status === "FAILED" || status === "CANCELED") {
        finished.fortune = true;
      }
    }

    if (finished.natal && finished.fortune) {
      return { done: !!(urls.natal && urls.fortune), urls };
    }

    await sleep(intervalMs);
  }

  return { done: false, urls };
}

function buildPartial(urls) {
  const partial = {};
  if (urls.natal) partial.natalChartUrl = urls.natal;
  if (urls.fortune) partial.fortuneUrl = urls.fortune;
  return partial;
}

function sanitizeApiUrl(envUrl, fallback) {
  const def =
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-async-synthesis";
  const fb = fallback || def;
  if (!envUrl) return fb;
  try {
    const u = new URL(envUrl);
    if (!u.hostname.includes("dashscope.aliyuncs.com")) return fb;
    let path = u.pathname;
    // 将同步端点自动改写为异步端点
    path = path
      .replace(
        /\/services\/aigc\/image-generation\/generation$/,
        "/services/aigc/image-generation/async-generation"
      )
      .replace(
        /\/services\/aigc\/text2image\/image-synthesis$/,
        "/services/aigc/text2image/image-async-synthesis"
      );
    const ok =
      /\/services\/aigc\/image-generation\/async-generation$/.test(path) ||
      /\/services\/aigc\/text2image\/image-async-synthesis$/.test(path);
    if (!ok) return fb;
    u.pathname = path;
    return u.toString();
  } catch {
    return fb;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
