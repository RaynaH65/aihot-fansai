// 「重点关注」专题定义 —— 前后端共享的唯一事实源。
// - terms：查自有历史库（资讯）用的关键词，OR 聚合
// - xTerms：抓 X（Twitter）社媒声量用的搜索词。经实测 apidojo/tweet-scraper
//   不支持 "(A OR B)" 括号组合和 "-filter:" 操作符，只能用
//   `关键词 min_faves:N since:日期` 这种简单形式，所以每个专题拆成多个独立 term。
// - minFaves：该专题的赞数门槛（高声量赛道调高，冷门赛道调低，防刷屏/防空结果）
export const TOPICS = [
  {
    key: 't-game',
    label: 'AI 互动影游',
    terms: ['互动影游', '互动剧', 'AI 游戏', 'AI游戏', '影游', 'interactive film', 'AI NPC'],
    xTerms: ['"AI game"', '"AI NPC"', '"interactive film" AI', 'AI游戏'],
    minFaves: 30,
  },
  {
    key: 't-video',
    label: 'AI 视频',
    terms: ['AI 视频', 'AI视频', '视频生成', 'text-to-video', '文生视频', 'Sora', 'Veo', 'Runway'],
    xTerms: ['"AI video"', 'Sora', '"Veo 3"', 'Runway AI'],
    minFaves: 300,
  },
  {
    key: 't-world',
    label: '世界模型',
    terms: ['世界模型', 'world model', 'world simulator', 'Genie'],
    xTerms: ['"world model"', '"world simulator"', 'Genie AI'],
    minFaves: 100,
  },
  {
    key: 't-vmodel',
    label: '视频模型',
    terms: ['视频模型', 'video model', '可灵', 'Kling', '即梦', 'Veo', 'Runway', 'Sora', '海螺'],
    xTerms: ['"video model"', 'Kling', 'Hailuo', '可灵'],
    minFaves: 100,
  },
  {
    key: 't-music',
    label: 'AI 音乐',
    terms: ['AI 音乐', 'AI音乐', '音乐生成', 'Suno', 'Udio', '音乐模型', 'text-to-music'],
    xTerms: ['"AI music"', 'Suno', 'Udio', 'AI音乐'],
    minFaves: 50,
  },
  {
    key: 't-comic',
    label: 'AI 漫画',
    terms: ['AI 漫画', 'AI漫画', '漫画生成', 'AI comic', 'webtoon'],
    xTerms: ['"AI comic"', '"AI manga"', '"AI webtoon"', 'AI漫画'],
    minFaves: 20,
  },
  {
    key: 't-drama',
    label: 'AI 漫剧',
    terms: ['漫剧', 'AI 短剧', 'AI短剧', '短剧'],
    xTerms: ['"AI short drama"', 'AI短剧', '漫剧'],
    minFaves: 10,
  },
  {
    key: 't-dance',
    label: 'AI 舞蹈',
    terms: ['AI 舞蹈', 'AI舞蹈', '舞蹈生成', '动作生成', 'motion generation', 'dance'],
    xTerms: ['"AI dance"', '"motion generation"', 'AI舞蹈'],
    minFaves: 20,
  },
];

export const topicByKey = (key) => TOPICS.find((t) => t.key === key) || null;
