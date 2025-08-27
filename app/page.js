"use client";

import { useState, useMemo, useEffect } from "react";
import Image from "next/image";
import axios from "axios";
import { useForm } from "react-hook-form";

export default function Page() {
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      year: "",
      month: "",
      day: "",
      hour: "",
      minute: "",
      city: ""
    }
  });

  const [coords, setCoords] = useState(null); // {lat, lng, city}
  const [loading, setLoading] = useState(false);
  const [imgs, setImgs] = useState(null); // { natalChartUrl, fortuneUrl }
  const [error, setError] = useState("");

  const city = watch("city");

  // 城市输入自动触发获取经纬度（防抖）
  useEffect(() => {
    const v = city?.trim();
    if (!v) return;
    const t = setTimeout(() => {
      onGetLocation();
    }, 600);
    return () => clearTimeout(t);
  }, [city]);

  const onGetLocation = async () => {
    setError("");
    setCoords(null);
    const v = city?.trim();
    if (!v) {
      setError("请输入城市名称");
      return;
    }
    try {
      const res = await axios.post("/api/location", { city: v });
      if (res.data?.code === 200) {
        setCoords({ ...res.data.data, city: v });
      } else {
        setError(res.data?.msg || "获取经纬度失败");
      }
    } catch (e) {
      setError("获取经纬度失败");
    }
  };

  const disabledFuture = useMemo(() => {
    const y = parseInt(watch("year"));
    const m = parseInt(watch("month"));
    const d = parseInt(watch("day"));
    const hh = parseInt(watch("hour"));
    const mm = parseInt(watch("minute"));
    if (!y || !m || !d) return false;
    const input = new Date(y, (m - 1) || 0, d || 1, hh || 0, mm || 0);
    return input.getTime() > Date.now();
  }, [watch("year"), watch("month"), watch("day"), watch("hour"), watch("minute")]);

  const onSubmit = async (values) => {
    setError("");
    setImgs(null);
    if (!coords?.lat || !coords?.lng) {
      setError("请先获取城市经纬度");
      return;
    }
    const { year, month, day, hour, minute } = values;
    if (!(year && month && day && hour !== "" && minute !== "")) {
      setError("请完整填写生日日期与时间");
      return;
    }
    if (disabledFuture) {
      setError("生日不能是未来时间");
      return;
    }
    setLoading(true);
    try {
      // 调用星盘计算
      const astroRes = await axios.post("/api/astrology", {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        lat: Number(coords.lat),
        lng: Number(coords.lng),
        tzOffset: new Date(Number(year), Number(month)-1, Number(day), Number(hour), Number(minute)).getTimezoneOffset()
      });
      if (astroRes.data?.code !== 200) {
        throw new Error(astroRes.data?.msg || "星盘计算失败");
      }
      const astrologyData = astroRes.data.data;

      // 构造当前月份字符串
      const now = new Date();
      const currentMonth = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月`;

      // 调用图片生成
      const imgRes = await axios.post("/api/image", {
        astrologyData,
        currentMonth
      });
      if (imgRes.data?.code !== 200) {
        throw new Error(imgRes.data?.msg || "图片生成失败");
      }
      setImgs(imgRes.data.data);
    } catch (e) {
      setError(e.message || "生成失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  const onReset = () => {
    setImgs(null);
    setCoords(null);
    setError("");
  };

  return (
    <div className="container-main">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h1 className="text-xl font-semibold mb-4">输入信息</h1>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">年</label>
                <input type="number" className="input" placeholder="如 2000" {...register("year", { required: true })} />
                {errors.year && <p className="text-red-500 text-sm mt-1">必填</p>}
              </div>
              <div>
                <label className="label">月</label>
                <input type="number" className="input" placeholder="1-12" {...register("month", { required: true, min:1, max:12 })} />
                {errors.month && <p className="text-red-500 text-sm mt-1">1-12</p>}
              </div>
              <div>
                <label className="label">日</label>
                <input type="number" className="input" placeholder="1-31" {...register("day", { required: true, min:1, max:31 })} />
                {errors.day && <p className="text-red-500 text-sm mt-1">1-31</p>}
              </div>
              <div>
                <label className="label">时</label>
                <input type="number" className="input" placeholder="0-23" {...register("hour", { required: true, min:0, max:23 })} />
                {errors.hour && <p className="text-red-500 text-sm mt-1">0-23</p>}
              </div>
              <div>
                <label className="label">分</label>
                <input type="number" className="input" placeholder="0-59" {...register("minute", { required: true, min:0, max:59 })} />
                {errors.minute && <p className="text-red-500 text-sm mt-1">0-59</p>}
              </div>
            </div>

            <div>
              <label className="label">城市</label>
              <div className="flex gap-2">
                <input className="input" placeholder="如 上海、北京、深圳" {...register("city", { required: true })} />
                <button type="button" className="button-primary whitespace-nowrap" onClick={onGetLocation}>获取经纬度</button>
              </div>
              {coords?.lat && (
                <p className="text-green-600 text-sm mt-2">
                  已获取 {coords.city} 经纬度：lat {coords.lat}, lng {coords.lng}
                </p>
              )}
            </div>

            {disabledFuture && <p className="text-orange-600 text-sm">生日不能是未来时间</p>}
            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button type="submit" className="button-primary" disabled={loading}>
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4A4 4 0 004 12z"></path>
                    </svg>
                    生成中...
                  </span>
                ) : "生成图片"}
              </button>
              <button type="button" className="button-primary bg-gray-100 text-gray-800 hover:bg-gray-200" onClick={onReset}>重置</button>
            </div>
          </form>
        </div>

        <div className="card p-5">
          <h2 className="text-xl font-semibold mb-4">结果展示</h2>
          {!imgs ? (
            <div className="text-gray-500">将生成的出生日星盘图与本月运势图并排展示</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="image-box">
                <Image src={imgs.natalChartUrl} alt="出生日星盘图" width={800} height={800} className="w-full h-auto cursor-zoom-in" onClick={() => window.open(imgs.natalChartUrl, "_blank")} />
              </div>
              <div className="image-box">
                <Image src={imgs.fortuneUrl} alt="本月运势图" width={800} height={800} className="w-full h-auto cursor-zoom-in" onClick={() => window.open(imgs.fortuneUrl, "_blank")} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}