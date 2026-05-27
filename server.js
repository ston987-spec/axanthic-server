const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
 
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
 
const FEEDLE_COOKIE = process.env.FEEDLE_COOKIE || '';
const NAVER_COOKIE = process.env.NAVER_COOKIE || '';
 
// ── 피들 한국 HTML 파싱 방식 ──
app.get('/api/feedle', async (req, res) => {
  const results = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const url = `https://www.feedle.me/?species=0001&trait=0013&page=${page}`;
      const r = await fetch(url, {
        headers: {
          'Cookie': FEEDLE_COOKIE,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko-KR,ko;q=0.9'
        }
      });
      if (!r.ok) break;
      const html = await r.text();
      const $ = cheerio.load(html);
 
      const cards = [];
      $('a[href*="/pet/"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const idM = href.match(/\/pet\/([a-f0-9-]{36})/);
        if (!idM) return;
        const id = idM[1];
        if (results.find(r => r.id === id)) return;
 
        const text = $(el).text().trim();
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const priceStr = lines.find(l => l.includes('원'));
        const price = priceStr ? parseInt(priceStr.replace(/[^0-9]/g, '')) : 0;
        if (price <= 0) return;
 
        const name = lines[1] || lines[0] || '아잔틱';
        const sex = lines.find(l => ['수컷','암컷','미구분'].includes(l)) || '미구분';
        const size = lines.find(l => ['베이비','주브나일','서브어덜트','어덜트'].includes(l)) || '';
        const region = lines[lines.length - 1] || '';
        const seller = lines[lines.length - 2] || '';
 
        // 이미지: data-src 또는 next/image URL
        const imgEl = $(el).find('img');
        let imgSrc = imgEl.attr('data-src') || imgEl.attr('src') || '';
        if (imgSrc.includes('nego.svg') || imgSrc.includes('assets/')) {
          imgSrc = `https://www.feedle.me/api/pet-image/${id}`;
        }
 
        cards.push({ id, name, sex, size, price, seller, region, imgSrc });
      });
 
      if (cards.length === 0) break;
      results.push(...cards.map(p => ({
        ...p,
        priceDisplay: p.price.toLocaleString('ko-KR') + '원',
        src: 'feedle',
        url: `https://www.feedle.me/pet/${p.id}`
      })));
 
      // 다음 페이지 있는지 확인
      const hasNext = html.includes(`page=${page + 1}`) || $('a[href*="page=' + (page+1) + '"]').length > 0;
      if (!hasNext && page > 1) break;
 
      await sleep(300);
    }
    console.log(`피들 ${results.length}개 수집`);
    res.json({ success: true, count: results.length, data: results });
  } catch(e) {
    console.error('피들 오류:', e.message);
    res.status(500).json({ success: false, error: e.message, data: [] });
  }
});
 
// ── 개별 개체 이미지 가져오기 ──
app.get('/api/pet-image/:id', async (req, res) => {
  try {
    const r = await fetch(`https://www.feedle.me/pet/${req.params.id}`, {
      headers: { 'Cookie': FEEDLE_COOKIE, 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await r.text();
    const $ = cheerio.load(html);
    const ogImg = $('meta[property="og:image"]').attr('content') || '';
    res.json({ imgUrl: ogImg });
  } catch(e) {
    res.json({ imgUrl: '' });
  }
});
 
// ── 파사모 HTML 파싱 ──
app.get('/api/pasamo', async (req, res) => {
  const results = [];
  try {
    const queries = ['아잔틱', 'axanthic'];
    for (const kw of queries) {
      for (let page = 1; page <= 3; page++) {
        const url = `https://cafe.naver.com/ArticleSearchList.nhn?search.clubid=10421985&search.searchdate=all&search.searchBy=0&search.query=${encodeURIComponent(kw)}&search.page=${page}`;
        const r = await fetch(url, {
          headers: {
            'Cookie': NAVER_COOKIE,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://cafe.naver.com/reptilia'
          }
        });
        if (!r.ok) break;
        const html = await r.text();
        const $ = cheerio.load(html);
        const articles = [];
 
        $('.article-board tbody tr, .board-list tbody tr, .article_table tbody tr').each((i, el) => {
          const titleEl = $(el).find('a.article, .td_article a, td.td_article a').first();
          const title = titleEl.text().trim();
          if (!title || !/(아잔틱|axanthic)/i.test(title)) return;
          const href = titleEl.attr('href') || '';
          const idM = href.match(/articleid=(\d+)/i) || href.match(/\/(\d+)$/);
          if (!idM) return;
          const articleId = idM[1];
          if (results.find(r => r.id === articleId)) return;
          articles.push({ id: articleId, title });
        });
 
        // 본문에서 가격+이미지 파싱
        for (const article of articles.slice(0, 8)) {
          try {
            const ar = await fetch(`https://cafe.naver.com/reptilia/${article.id}`, {
              headers: { 'Cookie': NAVER_COOKIE, 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://cafe.naver.com' }
            });
            if (!ar.ok) continue;
            const aHtml = await ar.text();
            const price = parseKRW(aHtml);
            if (!price) continue;
 
            const $a = cheerio.load(aHtml);
            const imgSrc = $a('.se-image-resource, .ContentRenderer img, .se-module-image img').first().attr('src') ||
                           $a('meta[property="og:image"]').attr('content') || null;
 
            results.push({
              id: article.id,
              name: article.title.slice(0, 50),
              price, priceDisplay: price.toLocaleString('ko-KR') + '원',
              sex: guessSex(aHtml), size: guessSize(aHtml),
              seller: '', region: '',
              imgSrc, src: 'pasamo',
              url: `https://cafe.naver.com/reptilia/${article.id}`
            });
            await sleep(300);
          } catch(e) {}
        }
        if (articles.length === 0) break;
        await sleep(500);
      }
    }
    console.log(`파사모 ${results.length}개 수집`);
    res.json({ success: true, count: results.length, data: results });
  } catch(e) {
    console.error('파사모 오류:', e.message);
    res.status(500).json({ success: false, error: e.message, data: [] });
  }
});
 
// ── 통합 검색 ──
app.get('/api/search', async (req, res) => {
  try {
    const base = `http://localhost:${PORT}`;
    const [fr, pr] = await Promise.allSettled([
      fetch(`${base}/api/feedle`).then(r => r.json()),
      fetch(`${base}/api/pasamo`).then(r => r.json())
    ]);
    const fd = fr.status === 'fulfilled' ? (fr.value.data || []) : [];
    const pd = pr.status === 'fulfilled' ? (pr.value.data || []) : [];
    const all = [...fd, ...pd];
    res.json({ success: true, count: all.length, feedleCount: fd.length, pasamoCount: pd.length, data: all });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
 
function parseKRW(t) {
  const pats = [[/분양가\s*:?\s*([\d,]+)\s*만원/,true],[/가격\s*:?\s*([\d,]+)\s*만원/,true],
    [/([\d,]+)\s*만원/,true],[/([\d]+)\s*만\b/,true],[/₩\s*([\d,]+)/,false],[/([\d,]{5,})\s*원/,false]];
  for(const [p,m] of pats){const x=t.match(p);if(!x)continue;let n=+x[1].replace(/,/g,'');if(m)n*=10000;if(n>=10000&&n<=50000000)return n;}
  return 0;
}
function guessSex(t){return/수컷|male/i.test(t)?'수컷':/암컷|female/i.test(t)?'암컷':'미구분';}
function guessSize(t){return/베이비|baby/i.test(t)?'베이비':/주브나일|juvenile/i.test(t)?'주브나일':/서브어덜트|subadult/i.test(t)?'서브어덜트':/어덜트|adult/i.test(t)?'어덜트':'';}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
 
const PORT = process.env.PORT || 3000;
app.get('/api/debug', async (req, res) => {
  try {
    const r = await fetch('https://www.feedle.me/?species=0001&trait=0013', {
      headers: {
        'Cookie': FEEDLE_COOKIE,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    const html = await r.text();
    const hasPet = html.includes('/pet/');
    const hasAxanthic = html.includes('아잔틱');
    const cookieUsed = FEEDLE_COOKIE ? FEEDLE_COOKIE.slice(0, 30) + '...' : '없음';
    res.json({
      status: r.status,
      hasPet,
      hasAxanthic,
      cookieUsed,
      htmlLen: html.length,
      sample: html.slice(0, 500)
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
