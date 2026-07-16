// 「重点关注」专题定义 —— 前后端共享的唯一事实源。
// - terms：查自有历史库（资讯）用的关键词，OR 聚合；也用作社媒结果的相关性后置过滤
// - xTerms：X（Twitter）搜索词。实测 apidojo/tweet-scraper 不支持 "(A OR B)" 括号和
//   "-filter:"，只能 `关键词 min_faves:N since:日期` 一词一条
// - redditTerms / ytQueries / igHashtags：其余平台的搜索词（Reddit/YouTube 搜索是模糊匹配，
//   结果还要过 matchesTopic() 相关性过滤）
// - minFaves：X 的赞数门槛（高声量赛道调高，冷门赛道调低）
export const TOPICS = [
  {
    key: 't-game',
    label: 'AI 互动影游',
    terms: ['互动影游', '互动剧', 'AI 游戏', 'AI游戏', '影游', 'interactive film', 'AI NPC'],
    xTerms: ['"AI game"', '"AI NPC"', '"interactive film" AI', 'AI游戏'],
    redditTerms: ['"AI game"', '"AI NPC"'],
    ytQueries: ['AI game', 'AI NPC interactive'],
    igHashtags: ['aigame', 'aigaming'],
    matchTerms: ['ai game', 'ai gaming', 'ai npc', 'interactive film', 'interactive fiction', 'ai游戏', '互动影游', '互动剧', '影游'],
    minFaves: 30,
  },
  {
    key: 't-video',
    label: 'AI 视频',
    terms: ['AI 视频', 'AI视频', '视频生成', 'text-to-video', '文生视频', 'Sora', 'Veo', 'Runway'],
    xTerms: ['"AI video"', 'Sora', '"Veo 3"', 'Runway AI'],
    redditTerms: ['"AI video"', 'Sora OR Veo'],
    ytQueries: ['AI video generator', 'Sora AI video'],
    igHashtags: ['aivideo', 'sora'],
    matchTerms: ['ai video', 'text-to-video', 'text to video', 'sora', 'veo', 'runway', 'ai视频', '视频生成', '文生视频'],
    minFaves: 300,
  },
  {
    key: 't-world',
    label: '世界模型',
    terms: ['世界模型', 'world model', 'world simulator', 'Genie'],
    xTerms: ['"world model"', '"world simulator"', 'Genie AI'],
    redditTerms: ['"world model"'],
    ytQueries: ['world model AI'],
    igHashtags: ['worldmodel'],
    matchTerms: ['world model', 'world simulator', 'genie', '世界模型'],
    minFaves: 100,
  },
  {
    key: 't-vmodel',
    label: '视频模型',
    terms: ['视频模型', 'video model', '可灵', 'Kling', '即梦', 'Veo', 'Runway', 'Sora', '海螺'],
    xTerms: ['"video model"', 'Kling', 'Hailuo', '可灵'],
    redditTerms: ['Kling OR Hailuo', '"video model"'],
    ytQueries: ['Kling AI', 'video model AI'],
    igHashtags: ['klingai', 'veo3'],
    matchTerms: ['video model', 'kling', 'hailuo', 'veo', 'sora', 'runway', '可灵', '即梦', '海螺', '视频模型'],
    minFaves: 100,
  },
  {
    key: 't-music',
    label: 'AI 音乐',
    terms: ['AI 音乐', 'AI音乐', '音乐生成', 'Suno', 'Udio', '音乐模型', 'text-to-music'],
    xTerms: ['"AI music"', 'Suno', 'Udio', 'AI音乐'],
    redditTerms: ['"AI music"', 'Suno OR Udio'],
    ytQueries: ['AI music', 'Suno AI'],
    igHashtags: ['aimusic', 'sunoai'],
    matchTerms: ['ai music', 'suno', 'udio', 'text-to-music', 'music generation', 'ai音乐', '音乐生成', '音乐模型'],
    minFaves: 50,
  },
  {
    key: 't-comic',
    label: 'AI 漫画',
    terms: ['AI 漫画', 'AI漫画', '漫画生成', 'AI comic', 'webtoon'],
    xTerms: ['"AI comic"', '"AI manga"', '"AI webtoon"', 'AI漫画'],
    redditTerms: ['"AI comic" OR "AI manga"'],
    ytQueries: ['AI comic', 'AI manga'],
    igHashtags: ['aicomic', 'aimanga'],
    matchTerms: ['ai comic', 'ai manga', 'ai webtoon', 'comic generation', 'ai漫画', '漫画生成'],
    minFaves: 20,
  },
  {
    key: 't-drama',
    label: 'AI 漫剧',
    terms: ['漫剧', 'AI 短剧', 'AI短剧', '短剧'],
    xTerms: ['"AI short drama"', 'AI短剧', '漫剧'],
    redditTerms: ['"AI short drama"'],
    ytQueries: ['AI short drama', 'AI 短剧'],
    igHashtags: ['aidrama'],
    matchTerms: ['ai short drama', 'ai drama', 'short drama', 'ai短剧', '短剧', '漫剧'],
    minFaves: 10,
  },
  {
    key: 't-dance',
    label: 'AI 舞蹈',
    terms: ['AI 舞蹈', 'AI舞蹈', '舞蹈生成', '动作生成', 'motion generation', 'dance'],
    xTerms: ['"AI dance"', '"motion generation"', 'AI舞蹈'],
    redditTerms: ['"AI dance" OR "motion generation"'],
    ytQueries: ['AI dance generation'],
    igHashtags: ['aidance'],
    matchTerms: ['ai dance', 'motion generation', 'dance generation', 'ai舞蹈', '舞蹈生成', '动作生成'],
    minFaves: 20,
  },
];

export const topicByKey = (key) => TOPICS.find((t) => t.key === key) || null;

// 相关性后置过滤：Reddit/YouTube 的站内搜索是模糊匹配（实测会混进完全无关的热帖），
// 只保留标题/正文确实命中专题词的结果。
export function matchesTopic(topic, text) {
  if (!text) return false;
  const hay = text.toLowerCase();
  return topic.matchTerms.some((t) => hay.includes(t));
}

// 精选模式下论文的「FansAI 兴趣域」—— AI 原生内容相关方向才进精选（全部模式不受限）。
// 英文词全部加 \b 词边界（否则 sing 会命中 using、story 命中 history 之类的子串）。
// 注意：不放 multimodal（每篇 VLM 论文都带，噪音太大）；靠具体内容形态词命中。
export const PAPER_INTEREST_RE =
  /\b(world models?|videos?|music(al)?|audio|speech|voices?|songs?|singing|images?|visuals?|3d|4d|motions?|dance|dancing|avatars?|characters?|games?|gaming|npcs?|interactive|storytelling|narratives?|comics?|manga|anime|animations?|diffusion|cinematic|renders?|rendering|talking head)\b|text-to-|lip[- ]?sync|世界模型|视频|音乐|图像|文生|动画|漫画|游戏|舞蹈|数字人|虚拟人/i;
