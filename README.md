# aihot-fansai

仿 [aihot.virxact.com](https://aihot.virxact.com) 的 FansAI 内部 AI 资讯聚合。复用 aihot 公开 API，三部分：

```
aihot-fansai/
├── skill/SKILL.md         Claude Code Skill（包装 API + FansAI 视角呈现规范）
├── proxy/server.js        本地 Node 代理（:8787）—— 仅本地开发用
└── web/                   Vite + React + Tailwind v4 前端 + Vercel API 函数
    ├── api/[...path].js   Vercel Serverless Function（部署后接管代理职责）
    └── src/               React 应用
```

## 本地开发

需要两个进程：

```bash
# 1. 启动代理（:8787）
node proxy/server.js

# 2. 启动前端（:5173，dev proxy 自动转发 /api → :8787）
cd web && npm install && npm run dev
```

打开 http://localhost:5173

## 装 Skill

```bash
mkdir -p ~/.claude/skills/aihot-fansai
cp skill/SKILL.md ~/.claude/skills/aihot-fansai/
```

然后在 Claude Code 里直接问 "今天 AI 圈有什么"、"AI 日报"、"最近 OpenAI 发了什么"，Skill 会触发并按 FansAI 视角呈现（ROTO/MARKETRACK 关键词置顶、标杆公司单独标注）。

## 部署到 Vercel

1. **登录 [vercel.com](https://vercel.com)**（用 GitHub 账号一键登录）
2. **Add New → Project** → 选 `aihot-fansai` 仓库
3. **重要**：在配置页把 **Root Directory** 改成 `web`
   - Framework Preset 会自动识别成 Vite
   - 其他全默认即可
4. **Deploy** → 等 1–2 分钟拿到 `xxx.vercel.app` 的 URL

部署后前端调 `/api/*` 会自动走 `web/api/[...path].js` 这个 Serverless Function，不再依赖本地 proxy。

> 想绑自己的域名：Vercel 项目里 Settings → Domains 加一个就行。

## 数据源 & 合规

全部内容来自 https://aihot.virxact.com 公开 API，每条卡片附原文链接。footer 标注了数据来源。
