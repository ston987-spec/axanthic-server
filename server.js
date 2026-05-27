const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
 
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
 
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';
 
function parseKRW(text) {
  const pats = [
    [/분양가\s*:?\s*([\d,]+)\s*만원/, true],
    [/가격\s*:?\s*([\d,]+)\s*만원/, true],
    [/([\d,]+)\s*만원/, true],
    [/([\d]+)\s*만\b/, true],
    [/([\d,]{5,})\s*원/, false]
  ];
  for (const [pat, isMan] of pats) {
    const m = text.match(pat);
    if (!m) continue;
    let n = parseInt(m[1].replace(/,/g,''));
    if (isMan) n *= 10000;
    if (n >= 10000 && n <= 50000000) return n;
  }
  return 0;
}
 
// ── 파사모 API (네이버 검색 API 사용) ──
app.get('/api/pasamo', async (req, res) => {
  try {
    const results = [];
    const seen = new Set();
    const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
 
    for (const query of ['아잔틱 분양', '아잔틱']) {
      for (let start = 1; start <= 100; start += 100) {
        const url = `https://openapi.naver.com/v1/search/cafearticle.json?query=${encodeURIComponent(query)}&display=100&start=${start}&sort=date&cafe_url=cafe.naver.com/reptilia`;
 
        const r = await fetch(url, {
          headers: {
            'X-Naver-Client-Id': NAVER_CLIENT_ID,
            'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
          }
        });
 
        if (!r.ok) {
          console.error('Naver API error:', r.status, await r.text());
          break;
        }
 
        const data = await r.json();
        const items = data.items || [];
        if (items.length === 0) break;
 
        let hasOld = false;
        for (const item of items) {
          // 날짜 체크 (최근 2일)
          const pubDate = new Date(item.pubDate).getTime();
          if (pubDate < twoDaysAgo) { hasOld = true; continue; }
 
          // 제목에 아잔틱 포함 여부
          const title = item.title.replace(/<[^>]+>/g, '').trim();
          const desc = item.description.replace(/<[^>]+>/g, '').trim();
          if (!/(아잔틱|axanthic)/i.test(title + desc)) continue;
 
          // 중복 제거
          const articleId = item.link.match(/\/(\d+)(?:\?|$)/)?.[1] || item.link;
          if (seen.has(articleId)) continue;
          seen.add(articleId);
 
          // 가격 파싱 (제목 + 설명에서)
          const price = parseKRW(title + ' ' + desc);
 
          results.push({
            id: articleId,
            name: title.slice(0, 60),
            price: price,
            priceDisplay: price > 0 ? price.toLocaleString('ko-KR') + '원' : '가격 미기재',
            description: desc.slice(0, 100),
            pubDate: item.pubDate,
            src: 'pasamo',
            url: item.link,
            imgSrc: ''
          });
        }
 
        if (hasOld || items.length < 100) break;
      }
    }
 
    // 가격 있는 것 우선, 없는 것도 포함
    results.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
 
    console.log(`파사모 ${results.length}개 수집`);
    res.json({ success: true, count: results.length, data: results });
 
  } catch(e) {
    console.error('파사모 오류:', e.message);
    res.status(500).json({ success: false, error: e.message, data: [] });
  }
});
 
// ── 헬스체크 ──
app.get('/api/health', (req, res) => {
  res.json({ ok: true, naverConfigured: !!NAVER_CLIENT_ID });
});
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
 






