---
name: aihot-fansai
license: MIT
description: 查询 aihot.virxact.com 公开 API，获取实时 AI 行业资讯。是 aihot 的 FansAI 内部包装版，触发场景：用户问"今天 AI 圈有什么"、"AI 热点"、"最新 AI 动态"、"AI 日报"等问题。直接调公开 REST API，无需配置。
metadata:
  author: FansAI
  version: "0.1.0"
  upstream: https://aihot.virxact.com
---

# aihot-fansai Skill

包装 [aihot.virxact.com](https://aihot.virxact.com) 公开 API，专供 FansAI 内部使用。

## 必填 Header（缺则 403）

```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0
```

## 路由策略

| 用户请求 | 使用接口 |
|---|---|
| "今天 AI 圈有什么"（泛问） | `/api/public/items?mode=selected&since=<ISO>&take=30` |
| "AI 日报" | `/api/public/daily` |
| "指定某天日报" | `/api/public/daily/{YYYY-MM-DD}` |
| "全部/完整/所有" | `/api/public/items?mode=all&since=<ISO>` |
| "最近 N 天" | `/api/public/items?mode=selected&since=<ISO N天前>` |
| 关键词搜索 | `/api/public/items?q=<关键词>&take=30` |
| 按分类 | 加 `&category=<key>` |

**默认行为**：泛问用 `selected`、过去 24h、`take=30`。

## `since` 参数格式（重要）

**必须是 ISO 8601 UTC 时间**，例如 `2026-06-03T05:00:00Z`。**不能**写 `24h` / `7d`，否则 400。

```bash
# 24 小时前
SINCE=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)

# 7 天前
SINCE=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)
```

`since` 最多往前 7 天，超出会被截断。

## 接口

| 接口 | 用途 |
|---|---|
| `/api/public/daily` | 最新日报 |
| `/api/public/daily/{YYYY-MM-DD}` | 指定日期日报 |
| `/api/public/dailies?take=N` | 日报归档（N 最大 180） |
| `/api/public/items` | 所有更新（支持 q / mode / category / since / take / cursor） |

`items` 限制：`take` 最大 100，`cursor` 翻页。

## 分类（category 参数）

- `ai-models` — 模型发布/更新
- `ai-products` — 产品发布/更新
- `industry` — 行业动态
- `paper` — 论文研究
- `tip` — 技巧与观点

## 调用示例

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0"
SINCE=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)

# 今日精选
curl -s -H "User-Agent: $UA" \
  "https://aihot.virxact.com/api/public/items?mode=selected&since=${SINCE}&take=30"

# 最新日报
curl -s -H "User-Agent: $UA" "https://aihot.virxact.com/api/public/daily"

# 按分类
curl -s -H "User-Agent: $UA" \
  "https://aihot.virxact.com/api/public/items?mode=selected&category=ai-models&since=${SINCE}&take=20"

# 关键词
curl -s -H "User-Agent: $UA" \
  "https://aihot.virxact.com/api/public/items?q=MiniMax&take=30"
```

## 返回结构

```json
{
  "count": 30,
  "hasNext": true,
  "nextCursor": "...",
  "items": [{
    "id": "...",
    "title": "中文标题",
    "title_en": "原始标题/原文片段",
    "url": "原文 URL",
    "source": "来源标识，如 X：MiniMax (@MiniMax_AI)",
    "publishedAt": "2026-06-04T02:54:29.000Z",
    "summary": "中文摘要",
    "category": "ai-models | ai-products | industry | paper | tip"
  }]
}
```

## 呈现规范（FansAI 视角）

**不要暴露给用户**：接口路径、raw 参数、cursor、HTTP 状态、缓存信息。

**时间**：UTC 转北京时间，优先相对时间（"2 小时前"）或当日绝对时间（"今天上午 09:48"）。

**来源链接**：每条必带原文 URL，不省略。

**分类组织**：混合内容时按分类分组（模型 / 产品 / 行业 / 论文 / 技巧），跨分类连续编号。

**FansAI 关注点**（如果识别到下列关键词，置顶或加注）：
- AI 影游 / 互动叙事 / AI Companion / Character AI → 关联 ROTO 赛道
- AI 营销 / Creator 经济 / 达人投放 / 短视频生成 → 关联 MARKETRACK 赛道
- 标杆公司：MiniMax、Lightricks、美图 → 单独标注

**语言**：中文，自然流畅的资讯简报风格。
