# 星盘 + 本月运势（Next.js 14, App Router）

输入生日日期与城市，生成“出生日星盘图 + 本月运势图”。

## 技术栈
- Next.js 14（App Router，前后端一体化，Vercel Serverless Functions）
- Tailwind CSS（本地构建，无需CDN）
- swisseph（瑞士星历表，计算太阳/月亮/上升与宫位）
- 高德地理编码API（根据城市名获取经纬度）
- 通义万象（图片生成）
- axios（HTTP请求）

## 目录结构
- app/
  - page.js：前端页面（表单、交互、结果展示）
  - api/location/route.js：城市经纬度
  - api/astrology/route.js：星盘计算
  - api/image/route.js：图片生成
  - globals.css：全局样式（Tailwind）
- public/
- package.json
- tailwind.config.js
- postcss.config.js
- .env.example

## 环境变量
参考 .env.example，在 Vercel 项目设置中添加：
- AMAP_KEY
- TONGYI_API_KEY

## 部署说明（Vercel）
1. 推送代码到 GitHub/GitLab
2. 在 Vercel 导入该仓库，框架选择 Next.js
3. 在 Vercel 项目 Settings -> Environment Variables 中添加 .env.example 的变量
4. 点击 Deploy，等待构建完成

## 功能测试
- 示例：生日 2000-01-01 12:00，城市 “上海”
  - 步骤：
    1) 输入年月日时分、城市“上海”
    2) 点击“获取经纬度”显示 lat/lng
    3) 点击“生成图片”，预期显示两张图片
- 若未配置通义万象密钥与接口，接口将返回占位图用于联调（部署后请务必配置真实密钥）

## 注意事项
- 不在代码中硬编码任何密钥，均通过环境变量传入
- swisseph 需要星历表，代码已指向 node_modules/swisseph/ephe
- 生日时间将转换为UTC参与计算；客户端也会传 tzOffset（分钟）用于精确换算
- next/image 已设置固定宽高以避免布局偏移